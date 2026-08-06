import { Direction, system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { snapshotStates, toPublicJson } from "./format.js";
import { appendEntry } from "./storage.js";
import { nowMs } from "./time.js";

/**
 * @typedef {import("./format.js").LogEntry} LogEntry
 * @typedef {import("@minecraft/server").Block} Block
 */

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

  commit({
    t: nowMs(),
    p: player.name,
    a: "p",
    b: block.typeId,
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
    b: blockId,
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
 * Flint & steel / fire charge used on a block.
 * @param {import("@minecraft/server").PlayerInteractWithBlockAfterEvent} event
 */
function onPlayerInteractWithBlock(event) {
  if (event.isFirstEvent === false) return;

  const toolId =
    event.beforeItemStack?.typeId ?? event.itemStack?.typeId ?? "";
  if (!CONFIG.fireTools.includes(toolId)) return;

  const player = event.player;
  const clicked = event.block;
  if (!player || !clicked) return;

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
        tool: toolId,
      });
    } catch (err) {
      console.warn(`[BlockLogger] fire log failed: ${err}`);
    }
  });
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
 * Subscribe to place/break/fire events.
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
      "[BlockLogger] playerInteractWithBlock unavailable; flint/steel fire logging limited."
    );
  }

  if (after.projectileHitBlock) {
    after.projectileHitBlock.subscribe(onProjectileHitBlock);
  }
}
