import { system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { toPublicJson } from "./format.js";
import { appendEntry } from "./storage.js";
import { nowMs } from "./time.js";

/**
 * @typedef {import("./format.js").LogEntry} LogEntry
 * @typedef {import("@minecraft/server").Block} Block
 * @typedef {import("@minecraft/server").Container} Container
 * @typedef {import("@minecraft/server").Player} Player
 * @typedef {import("@minecraft/server").Entity} Entity
 */

/**
 * @typedef {object} ContainerSession
 * @property {string} playerName
 * @property {string} dimensionId
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {string} blockType
 * @property {Map<string, number>} before
 * @property {number} openedAtTick
 * @property {boolean} fromFallback
 */

/** @type {Map<string, ContainerSession>} playerName → open chest session */
const sessions = new Map();

let fallbackPollStarted = false;

/**
 * @param {Omit<LogEntry, "i">} partial
 * @returns {LogEntry}
 */
function commit(partial) {
  const entry = appendEntry(partial);
  const pub = toPublicJson(entry);
  if (CONFIG.debugConsole || CONFIG.bridgeConsole) {
    console.warn(`BLJSON:${JSON.stringify(pub)}`);
  }
  return entry;
}

/**
 * Aggregate item counts in a container (typeId → amount).
 * @param {Container | undefined} container
 * @returns {Map<string, number>}
 */
export function snapshotCounts(container) {
  /** @type {Map<string, number>} */
  const map = new Map();
  if (!container) return map;
  try {
    const size = container.size;
    for (let i = 0; i < size; i++) {
      const item = container.getItem(i);
      if (!item?.typeId) continue;
      const amt = item.amount ?? 1;
      map.set(item.typeId, (map.get(item.typeId) ?? 0) + amt);
    }
  } catch (err) {
    console.warn(`[BlockLogger] inventory snapshot failed: ${err}`);
  }
  return map;
}

/**
 * @param {Block} block
 * @returns {Container | undefined}
 */
function blockContainer(block) {
  try {
    const inv = block.getComponent?.("minecraft:inventory") ?? block.getComponent?.("inventory");
    return inv?.container;
  } catch {
    return undefined;
  }
}

/**
 * @param {Entity} entity
 * @returns {Container | undefined}
 */
function entityContainer(entity) {
  try {
    const inv =
      entity.getComponent?.("minecraft:inventory") ?? entity.getComponent?.("inventory");
    return inv?.container;
  } catch {
    return undefined;
  }
}

/**
 * @param {Map<string, number>} before
 * @param {Map<string, number>} after
 * @returns {{ took: { typeId: string, amount: number }[], put: { typeId: string, amount: number }[] }}
 */
function diffCounts(before, after) {
  /** @type {{ typeId: string, amount: number }[]} */
  const took = [];
  /** @type {{ typeId: string, amount: number }[]} */
  const put = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const typeId of keys) {
    const delta = (after.get(typeId) ?? 0) - (before.get(typeId) ?? 0);
    if (delta < 0) took.push({ typeId, amount: -delta });
    else if (delta > 0) put.push({ typeId, amount: delta });
  }
  return { took, put };
}

/**
 * @param {ContainerSession} session
 * @param {Map<string, number>} after
 */
function emitContainerDiff(session, after) {
  const { took, put } = diffCounts(session.before, after);
  const t = nowMs();

  for (const item of took) {
    commit({
      t,
      p: session.playerName,
      a: "u",
      b: item.typeId,
      x: session.x,
      y: session.y,
      z: session.z,
      d: session.dimensionId,
      c: item.amount,
      tool: session.blockType,
    });
  }
  for (const item of put) {
    commit({
      t,
      p: session.playerName,
      a: "v",
      b: item.typeId,
      x: session.x,
      y: session.y,
      z: session.z,
      d: session.dimensionId,
      c: item.amount,
      tool: session.blockType,
    });
  }
}

/**
 * Start tracking a block container session for a player.
 * @param {Player} player
 * @param {Block} block
 * @param {{ fromFallback?: boolean }} [opts]
 */
export function beginContainerSession(player, block, opts = {}) {
  if (!CONFIG.logContainerItems) return;
  if (!player || !block) return;

  const container = blockContainer(block);
  if (!container) return;

  sessions.set(player.name, {
    playerName: player.name,
    dimensionId: block.dimension.id,
    x: block.x,
    y: block.y,
    z: block.z,
    blockType: block.typeId,
    before: snapshotCounts(container),
    openedAtTick: system.currentTick,
    fromFallback: Boolean(opts.fromFallback),
  });

  if (opts.fromFallback) ensureFallbackPoll();
}

/**
 * Finish a session and log took/put diffs.
 * @param {string} playerName
 * @param {Block | undefined} block
 */
export function endContainerSession(playerName, block) {
  const session = sessions.get(playerName);
  if (!session) return;
  sessions.delete(playerName);

  let after = new Map();
  if (block) {
    after = snapshotCounts(blockContainer(block));
  } else {
    try {
      const dim = world.getDimension(session.dimensionId);
      const b = dim.getBlock({ x: session.x, y: session.y, z: session.z });
      after = snapshotCounts(b ? blockContainer(b) : undefined);
    } catch {
      after = session.before; // can't read — treat as no change
    }
  }

  emitContainerDiff(session, after);
}

/**
 * @param {import("@minecraft/server").BlockContainerOpenedAfterEvent} event
 */
function onBlockContainerOpened(event) {
  try {
    const source = event.openSource?.entity;
    if (!source || source.typeId !== "minecraft:player") return;
    beginContainerSession(/** @type {Player} */ (source), event.block, {
      fromFallback: false,
    });
  } catch (err) {
    console.warn(`[BlockLogger] container open track failed: ${err}`);
  }
}

/**
 * @param {import("@minecraft/server").BlockContainerClosedAfterEvent} event
 */
function onBlockContainerClosed(event) {
  try {
    const source = event.closeSource?.entity;
    if (!source || source.typeId !== "minecraft:player") return;
    endContainerSession(source.name, event.block);
  } catch (err) {
    console.warn(`[BlockLogger] container close track failed: ${err}`);
  }
}

/**
 * Entity containers (chest minecart, etc.).
 * @param {import("@minecraft/server").EntityContainerOpenedAfterEvent} event
 */
function onEntityContainerOpened(event) {
  if (!CONFIG.logContainerItems) return;
  try {
    const source = event.openSource?.entity;
    const target = event.entity;
    if (!source || source.typeId !== "minecraft:player" || !target) return;

    const container = entityContainer(target);
    if (!container) return;
    const loc = target.location;
    sessions.set(source.name, {
      playerName: source.name,
      dimensionId: target.dimension.id,
      x: Math.floor(loc.x),
      y: Math.floor(loc.y),
      z: Math.floor(loc.z),
      blockType: target.typeId,
      before: snapshotCounts(container),
      openedAtTick: system.currentTick,
      fromFallback: false,
    });
  } catch (err) {
    console.warn(`[BlockLogger] entity container open failed: ${err}`);
  }
}

/**
 * @param {import("@minecraft/server").EntityContainerClosedAfterEvent} event
 */
function onEntityContainerClosed(event) {
  try {
    const source = event.closeSource?.entity;
    if (!source || source.typeId !== "minecraft:player") return;
    const session = sessions.get(source.name);
    if (!session) return;
    sessions.delete(source.name);

    const target = event.entity;
    const after = snapshotCounts(target ? entityContainer(target) : undefined);
    emitContainerDiff(session, after);
  } catch (err) {
    console.warn(`[BlockLogger] entity container close failed: ${err}`);
  }
}

/**
 * Fallback when blockContainerOpened/Closed are missing:
 * close the session once the player walks away or times out.
 */
function ensureFallbackPoll() {
  if (fallbackPollStarted) return;
  fallbackPollStarted = true;

  system.runInterval(() => {
    if (!sessions.size) return;
    const maxTicks = Math.max(20, (CONFIG.containerSessionMaxSeconds ?? 60) * 20);
    const maxDist = CONFIG.containerSessionMaxDistance ?? 8;
    const maxDistSq = maxDist * maxDist;

    for (const [name, session] of [...sessions.entries()]) {
      if (!session.fromFallback) continue;

      if (system.currentTick - session.openedAtTick > maxTicks) {
        endContainerSession(name, undefined);
        continue;
      }

      const player = [...world.getPlayers()].find((p) => p.name === name);
      if (!player) {
        endContainerSession(name, undefined);
        continue;
      }

      try {
        if (player.dimension.id !== session.dimensionId) {
          endContainerSession(name, undefined);
          continue;
        }
        const loc = player.location;
        const dx = loc.x - (session.x + 0.5);
        const dy = loc.y - (session.y + 0.5);
        const dz = loc.z - (session.z + 0.5);
        if (dx * dx + dy * dy + dz * dz > maxDistSq) {
          endContainerSession(name, undefined);
        }
      } catch {
        endContainerSession(name, undefined);
      }
    }
  }, 10);
}

/**
 * @param {Entity} itemEntity
 * @returns {{ typeId: string, amount: number } | undefined}
 */
function stackFromItemEntity(itemEntity) {
  try {
    const comp =
      itemEntity.getComponent?.("minecraft:item") ?? itemEntity.getComponent?.("item");
    const stack = comp?.itemStack;
    if (!stack?.typeId) return undefined;
    return { typeId: stack.typeId, amount: stack.amount ?? 1 };
  } catch {
    return undefined;
  }
}

/**
 * @param {import("@minecraft/server").EntityItemPickupAfterEvent} event
 */
function onItemPickup(event) {
  if (!CONFIG.logItemPickup) return;
  try {
    const entity = event.entity;
    if (!entity || entity.typeId !== "minecraft:player") return;

    const loc = entity.location;
    const dim = entity.dimension?.id ?? "minecraft:overworld";
    const items = event.items ?? [];

    for (const stack of items) {
      if (!stack?.typeId) continue;
      commit({
        t: nowMs(),
        p: entity.name ?? entity.nameTag ?? "Unknown",
        a: "i",
        b: stack.typeId,
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z),
        d: dim,
        c: stack.amount ?? 1,
        tool: "pickup",
      });
    }
  } catch (err) {
    console.warn(`[BlockLogger] pickup log failed: ${err}`);
  }
}

/**
 * @param {import("@minecraft/server").EntityItemDropAfterEvent} event
 */
function onItemDrop(event) {
  if (!CONFIG.logItemDrop) return;
  try {
    const entity = event.entity;
    if (!entity || entity.typeId !== "minecraft:player") return;

    const loc = entity.location;
    const dim = entity.dimension?.id ?? "minecraft:overworld";
    const dropped = event.items ?? [];

    for (const itemEnt of dropped) {
      const stack = stackFromItemEntity(itemEnt);
      if (!stack) continue;
      commit({
        t: nowMs(),
        p: entity.name ?? entity.nameTag ?? "Unknown",
        a: "j",
        b: stack.typeId,
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z),
        d: dim,
        c: stack.amount,
        tool: "drop",
      });
    }
  } catch (err) {
    console.warn(`[BlockLogger] drop log failed: ${err}`);
  }
}

/**
 * Wire inventory / container / pickup / drop logging.
 * @returns {{ hasNativeContainerEvents: boolean }}
 */
export function registerInventoryEvents() {
  const after = world.afterEvents;
  let hasNativeContainerEvents = false;

  if (after.blockContainerOpened && after.blockContainerClosed) {
    after.blockContainerOpened.subscribe(onBlockContainerOpened);
    after.blockContainerClosed.subscribe(onBlockContainerClosed);
    hasNativeContainerEvents = true;
  } else {
    console.warn(
      "[BlockLogger] blockContainerOpened/Closed unavailable; using distance fallback for chest item diffs."
    );
    ensureFallbackPoll();
  }

  if (after.entityContainerOpened && after.entityContainerClosed) {
    after.entityContainerOpened.subscribe(onEntityContainerOpened);
    after.entityContainerClosed.subscribe(onEntityContainerClosed);
  }

  if (after.entityItemPickup) {
    after.entityItemPickup.subscribe(onItemPickup);
  } else {
    console.warn("[BlockLogger] entityItemPickup unavailable; pickup logging disabled.");
  }

  if (after.entityItemDrop) {
    after.entityItemDrop.subscribe(onItemDrop);
  } else {
    console.warn("[BlockLogger] entityItemDrop unavailable; drop logging disabled.");
  }

  return { hasNativeContainerEvents };
}
