import { Direction, system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { snapshotStates, toPublicJson } from "./format.js";
import { appendEntry } from "./storage.js";
import { nowMs } from "./time.js";

/**
 * @typedef {import("./format.js").LogEntry} LogEntry
 * @typedef {import("@minecraft/server").Block} Block
 */

/** @type {Map<string, number>} player:x,y,z → expire tick (dedupe bucket + place) */
const recentLiquidLogs = new Map();

/**
 * @param {Omit<LogEntry, "i">} partial
 * @returns {LogEntry}
 */
function commit(partial) {
  const entry = appendEntry(partial);
  exportEntry(entry);
  return entry;
}

/**
 * @param {string} playerName
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function markLiquidLogged(playerName, x, y, z) {
  const key = `${playerName}:${x},${y},${z}`;
  recentLiquidLogs.set(key, system.currentTick + 3);
  // Opportunistic cleanup
  if (recentLiquidLogs.size > 200) {
    const tick = system.currentTick;
    for (const [k, exp] of recentLiquidLogs) {
      if (exp < tick) recentLiquidLogs.delete(k);
    }
  }
}

/**
 * @param {string} playerName
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {boolean}
 */
function wasRecentlyLiquidLogged(playerName, x, y, z) {
  const key = `${playerName}:${x},${y},${z}`;
  const exp = recentLiquidLogs.get(key);
  if (exp === undefined) return false;
  if (system.currentTick > exp) {
    recentLiquidLogs.delete(key);
    return false;
  }
  return true;
}

/**
 * @param {string} typeId
 * @returns {boolean}
 */
function isLiquidBlock(typeId) {
  return CONFIG.liquidBlocks.includes(typeId);
}

/**
 * Normalize flowing_* to the source id we store in logs.
 * @param {string} typeId
 * @returns {string}
 */
function normalizeLiquidId(typeId) {
  if (typeId === "minecraft:flowing_water") return "minecraft:water";
  if (typeId === "minecraft:flowing_lava") return "minecraft:lava";
  return typeId;
}

/**
 * Record a player block placement.
 * @param {import("@minecraft/server").PlayerPlaceBlockAfterEvent} event
 */
export function onPlayerPlaceBlock(event) {
  const { player, block } = event;
  if (!player || !block) return;

  // Fire placed as a block (some interactions)
  if (CONFIG.fireBlocks.includes(block.typeId)) {
    commit({
      t: nowMs(),
      p: player.name,
      a: "f",
      b: block.typeId,
      x: block.x,
      y: block.y,
      z: block.z,
      d: block.dimension.id,
      s: snapshotStates(block.permutation),
      tool: "place",
    });
    return;
  }

  // Bucket pours are logged via interact; skip duplicate place events.
  if (
    isLiquidBlock(block.typeId) &&
    wasRecentlyLiquidLogged(player.name, block.x, block.y, block.z)
  ) {
    return;
  }

  if (isLiquidBlock(block.typeId)) {
    markLiquidLogged(player.name, block.x, block.y, block.z);
  }

  commit({
    t: nowMs(),
    p: player.name,
    a: "p",
    b: normalizeLiquidId(block.typeId),
    x: block.x,
    y: block.y,
    z: block.z,
    d: block.dimension.id,
    s: snapshotStates(block.permutation),
  });
}

/**
 * Record a player block break.
 * @param {import("@minecraft/server").PlayerBreakBlockAfterEvent} event
 */
export function onPlayerBreakBlock(event) {
  const { player, block, brokenBlockPermutation } = event;
  if (!player || !block) return;

  const blockId =
    brokenBlockPermutation?.type?.id ??
    brokenBlockPermutation?.typeId ??
    "minecraft:air";

  commit({
    t: nowMs(),
    p: player.name,
    a: "b",
    b: normalizeLiquidId(blockId),
    x: block.x,
    y: block.y,
    z: block.z,
    d: block.dimension.id,
    s: snapshotStates(brokenBlockPermutation),
  });
}

/**
 * @param {Block} block
 * @param {string | Direction} face
 * @returns {Block | undefined}
 */
function blockOnFace(block, face) {
  const f = String(face);
  try {
    if (f === Direction.Up || f === "Up") return block.above(1);
    if (f === Direction.Down || f === "Down") return block.below(1);
    if (f === Direction.North || f === "North") return block.north(1);
    if (f === Direction.South || f === "South") return block.south(1);
    if (f === Direction.East || f === "East") return block.east(1);
    if (f === Direction.West || f === "West") return block.west(1);
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Prefer the cell that now holds the fluid; fall back to the face cell / click.
 * @param {Block} clicked
 * @param {string | Direction} face
 * @param {string} expectedFluid
 * @returns {{ target: Block, blockName: string }}
 */
function resolveFluidTarget(clicked, face, expectedFluid) {
  const adjacent = blockOnFace(clicked, face);
  if (adjacent && isLiquidBlock(adjacent.typeId)) {
    return {
      target: adjacent,
      blockName: normalizeLiquidId(adjacent.typeId),
    };
  }
  if (isLiquidBlock(clicked.typeId)) {
    return {
      target: clicked,
      blockName: normalizeLiquidId(clicked.typeId),
    };
  }
  // Cauldron fill / placement rejected / creative edge cases — still log intent.
  if (adjacent) {
    return { target: adjacent, blockName: expectedFluid };
  }
  return { target: clicked, blockName: expectedFluid };
}

/**
 * Flint & steel / fire charge / water & lava buckets used on a block.
 * @param {import("@minecraft/server").PlayerInteractWithBlockAfterEvent} event
 */
function onPlayerInteractWithBlock(event) {
  if (event.isFirstEvent === false) return;

  const beforeId =
    event.beforeItemStack?.typeId ?? event.itemStack?.typeId ?? "";
  const afterId = event.itemStack?.typeId ?? "";

  const player = event.player;
  const clicked = event.block;
  if (!player || !clicked) return;

  // --- Liquid place (water / lava / powder snow bucket) ---
  const placeFluid = CONFIG.liquidPlaceBuckets[beforeId];
  if (placeFluid) {
    // Interact succeeded with a full bucket — pour (survival empties; creative may keep it).
    system.run(() => {
      try {
        const { target, blockName } = resolveFluidTarget(
          clicked,
          event.blockFace,
          placeFluid
        );
        if (wasRecentlyLiquidLogged(player.name, target.x, target.y, target.z)) {
          return;
        }
        markLiquidLogged(player.name, target.x, target.y, target.z);
        commit({
          t: nowMs(),
          p: player.name,
          a: "p",
          b: blockName,
          x: target.x,
          y: target.y,
          z: target.z,
          d: target.dimension.id,
          s: snapshotStates(target.permutation),
          tool: beforeId,
        });
      } catch (err) {
        console.warn(`[BlockLogger] liquid place log failed: ${err}`);
      }
    });
    return;
  }

  // --- Liquid pickup (empty bucket → water/lava/powder snow bucket) ---
  if (beforeId === "minecraft:bucket") {
    const pickedFluid = CONFIG.liquidPickupResults[afterId];
    if (pickedFluid) {
      system.run(() => {
        try {
          // Source is usually the clicked block (water/lava/cauldron).
          const target = isLiquidBlock(clicked.typeId)
            ? clicked
            : blockOnFace(clicked, event.blockFace) ?? clicked;
          if (wasRecentlyLiquidLogged(player.name, target.x, target.y, target.z)) {
            return;
          }
          markLiquidLogged(player.name, target.x, target.y, target.z);
          commit({
            t: nowMs(),
            p: player.name,
            a: "b",
            b: pickedFluid,
            x: target.x,
            y: target.y,
            z: target.z,
            d: target.dimension.id,
            tool: "minecraft:bucket",
          });
        } catch (err) {
          console.warn(`[BlockLogger] liquid pickup log failed: ${err}`);
        }
      });
      return;
    }
  }

  // --- Fire tools ---
  if (CONFIG.fireTools.includes(beforeId)) {
    // Defer one tick so fire/campfire/TNT state can update.
    system.run(() => {
      try {
        const adjacent = blockOnFace(clicked, event.blockFace);
        const litId = clicked.typeId;
        const adjId = adjacent?.typeId;

        /** @type {Block | undefined} */
        let target = undefined;
        /** @type {string} */
        let blockName = "minecraft:fire";

        if (adjacent && CONFIG.fireBlocks.includes(adjId ?? "")) {
          target = adjacent;
          blockName = adjId ?? "minecraft:fire";
        } else if (
          litId.includes("campfire") ||
          litId === "minecraft:tnt" ||
          litId.includes("candle")
        ) {
          // Lit campfire / primed TNT / candle — log the interacted block.
          target = clicked;
          blockName = litId;
        } else if (CONFIG.fireBlocks.includes(litId)) {
          target = clicked;
          blockName = litId;
        } else if (adjacent) {
          // Still log intended fire spot even if engine rejected placement.
          target = adjacent;
          blockName = "minecraft:fire";
        } else {
          target = clicked;
          blockName = litId || "minecraft:fire";
        }

        commit({
          t: nowMs(),
          p: player.name,
          a: "f",
          b: blockName,
          x: target.x,
          y: target.y,
          z: target.z,
          d: target.dimension.id,
          s: snapshotStates(target.permutation),
          tool: beforeId,
        });
      } catch (err) {
        console.warn(`[BlockLogger] fire log failed: ${err}`);
      }
    });
    return;
  }

  // --- Container open (chest / barrel / shulker / hopper / …) ---
  if (CONFIG.logContainerOpens && isContainerBlock(clicked.typeId)) {
    commit({
      t: nowMs(),
      p: player.name,
      a: "o",
      b: clicked.typeId,
      x: clicked.x,
      y: clicked.y,
      z: clicked.z,
      d: clicked.dimension.id,
      tool: beforeId || "hand",
    });
  }
}

/**
 * @param {string} typeId
 * @returns {boolean}
 */
function isContainerBlock(typeId) {
  if (!typeId) return false;
  for (const needle of CONFIG.containerBlocks) {
    if (typeId === needle || typeId.includes(needle)) return true;
  }
  return false;
}

/**
 * Best-effort actor label for non-player sources (TNT, creeper, …).
 * @param {import("@minecraft/server").Entity | undefined} entity
 * @returns {string}
 */
function actorLabel(entity) {
  if (!entity) return "Unknown";
  if (entity.typeId === "minecraft:player") {
    return entity.name ?? entity.nameTag ?? "Unknown";
  }
  if (entity.nameTag) return entity.nameTag;
  return String(entity.typeId || "unknown").replace("minecraft:", "");
}

/**
 * Blocks destroyed by an explosion (TNT, creeper, bed, crystal, …).
 * Fires once per destroyed block, with the pre-explosion permutation.
 * @param {import("@minecraft/server").BlockExplodeAfterEvent} event
 */
function onBlockExplode(event) {
  if (!CONFIG.logExplosions) return;

  try {
    const perm = event.explodedBlockPermutation;
    const blockId =
      perm?.type?.id ??
      // @ts-ignore
      perm?.typeId ??
      "minecraft:air";
    if (!blockId || blockId === "minecraft:air") return;

    const block = event.block;
    if (!block) return;

    const source = event.source;
    commit({
      t: nowMs(),
      p: actorLabel(source),
      a: "e",
      b: blockId,
      x: block.x,
      y: block.y,
      z: block.z,
      d: block.dimension.id,
      s: snapshotStates(perm),
      tool: source?.typeId ?? "explosion",
    });
  } catch (err) {
    console.warn(`[BlockLogger] explosion log failed: ${err}`);
  }
}

/**
 * Player / protected-entity kills.
 * @param {import("@minecraft/server").EntityDieAfterEvent} event
 */
function onEntityDie(event) {
  if (!CONFIG.logKills) return;

  try {
    const dead = event.deadEntity;
    if (!dead) return;

    const damage = event.damageSource;
    const killer = damage?.damagingEntity;
    const cause = damage?.cause ? String(damage.cause) : "unknown";

    const victimIsPlayer = dead.typeId === "minecraft:player";
    const killerIsPlayer = killer?.typeId === "minecraft:player";
    const protectedVictim = CONFIG.killLogEntities.includes(dead.typeId);

    if (!victimIsPlayer && !killerIsPlayer && !protectedVictim) return;

    const loc = dead.location;
    if (!loc) return;

    let dimId = "minecraft:overworld";
    try {
      dimId = dead.dimension?.id ?? dimId;
    } catch {
      // entity may already be invalid for dimension access
    }

    const actor = killerIsPlayer
      ? killer.name ?? killer.nameTag ?? "Unknown"
      : killer
        ? actorLabel(killer)
        : `#${cause}`;

    const victimLabel = victimIsPlayer
      ? `player:${dead.name ?? dead.nameTag ?? "Unknown"}`
      : dead.typeId;

    commit({
      t: nowMs(),
      p: String(actor),
      a: "k",
      b: victimLabel,
      x: Math.floor(loc.x),
      y: Math.floor(loc.y),
      z: Math.floor(loc.z),
      d: dimId,
      tool: killer?.typeId
        ? `${cause}/${killer.typeId}`
        : cause,
    });
  } catch (err) {
    console.warn(`[BlockLogger] kill log failed: ${err}`);
  }
}

/**
 * @param {import("@minecraft/server").Entity | undefined} entity
 * @returns {string | undefined}
 */
function heldItemId(entity) {
  if (!entity) return undefined;
  try {
    const eq = entity.getComponent?.("minecraft:equippable");
    const stack = eq?.getEquipment?.("Mainhand");
    return stack?.typeId;
  } catch {
    return undefined;
  }
}

/**
 * @param {import("@minecraft/server").EntityDamageSource | undefined} damageSource
 * @returns {import("@minecraft/server").Entity | undefined}
 */
function resolveAttacker(damageSource) {
  if (!damageSource) return undefined;
  if (damageSource.damagingEntity) return damageSource.damagingEntity;
  const proj = damageSource.damagingProjectile;
  if (!proj) return undefined;
  try {
    // @ts-ignore
    const owner = proj.getComponent?.("minecraft:projectile")?.owner;
    if (owner) return owner;
  } catch {
    // ignore
  }
  return proj;
}

/**
 * @param {import("@minecraft/server").Entity} attacker
 * @param {import("@minecraft/server").Entity} victim
 * @param {string} cause
 * @param {number | undefined} damage
 */
function logCombatHit(attacker, victim, cause, damage) {
  if (!CONFIG.logHits || !attacker || !victim) return;

  const attackerIsPlayer = attacker.typeId === "minecraft:player";
  const victimIsPlayer = victim.typeId === "minecraft:player";
  if (CONFIG.logHitsPlayersOnly && !attackerIsPlayer && !victimIsPlayer) {
    return;
  }

  const loc = victim.location ?? attacker.location;
  if (!loc) return;

  let dimId = "minecraft:overworld";
  try {
    dimId = victim.dimension?.id ?? attacker.dimension?.id ?? dimId;
  } catch {
    // ignore
  }

  const actor = attackerIsPlayer
    ? attacker.name ?? attacker.nameTag ?? "Unknown"
    : actorLabel(attacker);

  const victimLabel = victimIsPlayer
    ? `player:${victim.name ?? victim.nameTag ?? "Unknown"}`
    : victim.typeId;

  const held = heldItemId(attacker);
  const toolParts = [cause];
  if (held) toolParts.push(held);
  if (typeof damage === "number" && Number.isFinite(damage)) {
    toolParts.push(`${Math.round(damage * 10) / 10}hp`);
  }

  commit({
    t: nowMs(),
    p: String(actor),
    a: "h",
    b: victimLabel,
    x: Math.floor(loc.x),
    y: Math.floor(loc.y),
    z: Math.floor(loc.z),
    d: dimId,
    tool: toolParts.join("/"),
  });
}

/**
 * Melee hit (entity punches entity).
 * @param {import("@minecraft/server").EntityHitEntityAfterEvent} event
 */
function onEntityHitEntity(event) {
  try {
    logCombatHit(event.damagingEntity, event.hitEntity, "melee", undefined);
  } catch (err) {
    console.warn(`[BlockLogger] hit log failed: ${err}`);
  }
}

/**
 * Non-melee combat damage (arrows, tridents, throrns-style entity sources, …).
 * Melee is already covered by entityHitEntity — skip entityAttack to avoid doubles.
 * @param {import("@minecraft/server").EntityHurtAfterEvent} event
 */
function onEntityHurt(event) {
  if (!CONFIG.logHits) return;
  try {
    const cause = String(event.damageSource?.cause ?? "unknown");
    // Bedrock cause strings vary slightly by version.
    if (
      cause === "entityAttack" ||
      cause === "entity_attack" ||
      cause === "EntityAttack"
    ) {
      return;
    }

    const attacker = resolveAttacker(event.damageSource);
    if (!attacker) return; // environmental damage (fall, fire, drown, …)

    logCombatHit(attacker, event.hurtEntity, cause, event.damage);
  } catch (err) {
    console.warn(`[BlockLogger] hurt-hit log failed: ${err}`);
  }
}

/**
 * Fire charge projectile hitting a block.
 * @param {import("@minecraft/server").ProjectileHitBlockAfterEvent} event
 */
function onProjectileHitBlock(event) {
  try {
    const proj = event.projectile;
    const typeId = proj?.typeId ?? "";
    if (typeId !== "minecraft:small_fireball" && typeId !== "minecraft:fireball") {
      return;
    }

    // Best-effort player attribution via shooting entity if available.
    // @ts-ignore - optional API surface differs by version
    const source = event.source ?? proj?.getComponent?.("minecraft:projectile")?.owner;
    const playerName =
      source?.typeId === "minecraft:player"
        ? source.name ?? source.nameTag ?? "Unknown"
        : source?.nameTag || "Unknown";

    const hit = event.getBlockHit?.() ?? event.blockHit;
    const block = hit?.block;
    if (!block) return;

    system.run(() => {
      const face = hit?.face ?? hit?.blockFace;
      const adjacent = face ? blockOnFace(block, face) : undefined;
      const target =
        adjacent && CONFIG.fireBlocks.includes(adjacent.typeId)
          ? adjacent
          : CONFIG.fireBlocks.includes(block.typeId)
            ? block
            : adjacent ?? block;

      commit({
        t: nowMs(),
        p: String(playerName),
        a: "f",
        b: target.typeId?.startsWith?.("minecraft:")
          ? CONFIG.fireBlocks.includes(target.typeId)
            ? target.typeId
            : "minecraft:fire"
          : "minecraft:fire",
        x: target.x,
        y: target.y,
        z: target.z,
        d: target.dimension.id,
        tool: "minecraft:fire_charge",
      });
    });
  } catch (err) {
    console.warn(`[BlockLogger] projectile fire log failed: ${err}`);
  }
}

/**
 * Emit structured console lines for the BDS bridge and optional HTTP.
 * @param {LogEntry} entry
 */
function exportEntry(entry) {
  const pub = toPublicJson(entry);

  if (CONFIG.debugConsole || CONFIG.bridgeConsole) {
    console.warn(`BLJSON:${JSON.stringify(pub)}`);
  }

  maybeHttp(pub);
}

/**
 * @param {object} pub
 */
function maybeHttp(pub) {
  const endpoint = CONFIG.httpEndpoint;
  if (!endpoint) return;

  try {
    // @ts-ignore
    if (typeof fetch === "function") {
      const headers = { "Content-Type": "application/json" };
      if (CONFIG.httpApiKey) headers["X-BlockLogger-Key"] = CONFIG.httpApiKey;
      // @ts-ignore
      fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(pub),
      });
    }
  } catch (err) {
    console.warn(`[BlockLogger] HTTP log failed: ${err}`);
  }
}

/**
 * Subscribe to place/break/fire/liquid/explosion/kill/container events.
 */
export function registerLoggerEvents() {
  world.afterEvents.playerBreakBlock.subscribe(onPlayerBreakBlock);

  const after = world.afterEvents;
  if (after.playerPlaceBlock) {
    after.playerPlaceBlock.subscribe(onPlayerPlaceBlock);
  } else {
    console.warn(
      "[BlockLogger] afterEvents.playerPlaceBlock is unavailable; place logging disabled."
    );
  }

  if (after.playerInteractWithBlock) {
    after.playerInteractWithBlock.subscribe(onPlayerInteractWithBlock);
  } else {
    console.warn(
      "[BlockLogger] playerInteractWithBlock unavailable; bucket/fire/container logging limited."
    );
  }

  if (after.projectileHitBlock) {
    after.projectileHitBlock.subscribe(onProjectileHitBlock);
  }

  if (after.blockExplode) {
    after.blockExplode.subscribe(onBlockExplode);
  } else {
    console.warn(
      "[BlockLogger] blockExplode unavailable; explosion logging disabled."
    );
  }

  if (after.entityDie) {
    after.entityDie.subscribe(onEntityDie);
  } else {
    console.warn("[BlockLogger] entityDie unavailable; kill logging disabled.");
  }

  if (after.entityHitEntity) {
    after.entityHitEntity.subscribe(onEntityHitEntity);
  } else {
    console.warn(
      "[BlockLogger] entityHitEntity unavailable; melee hit logging disabled."
    );
  }

  if (after.entityHurt) {
    after.entityHurt.subscribe(onEntityHurt);
  } else {
    console.warn(
      "[BlockLogger] entityHurt unavailable; projectile hit logging limited."
    );
  }
}
