import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { snapshotStates, toPublicJson } from "./format.js";
import { appendEntry } from "./storage.js";
import { nowMs } from "./time.js";

/**
 * @typedef {import("./format.js").LogEntry} LogEntry
 */

/**
 * Record a player block placement.
 * @param {import("@minecraft/server").PlayerPlaceBlockAfterEvent} event
 */
export function onPlayerPlaceBlock(event) {
  const { player, block } = event;
  if (!player || !block) return;

  /** @type {Omit<LogEntry, "i">} */
  const partial = {
    t: nowMs(),
    p: player.name,
    a: "p",
    b: block.typeId,
    x: block.x,
    y: block.y,
    z: block.z,
    d: block.dimension.id,
    s: snapshotStates(block.permutation),
  };

  const entry = appendEntry(partial);
  maybeDebug(entry);
  maybeHttp(entry);
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

  /** @type {Omit<LogEntry, "i">} */
  const partial = {
    t: nowMs(),
    p: player.name,
    a: "b",
    b: blockId,
    x: block.x,
    y: block.y,
    z: block.z,
    d: block.dimension.id,
    s: snapshotStates(brokenBlockPermutation),
  };

  const entry = appendEntry(partial);
  maybeDebug(entry);
  maybeHttp(entry);
}

/**
 * @param {LogEntry} entry
 */
function maybeDebug(entry) {
  if (!CONFIG.debugConsole) return;
  console.warn(`[BlockLogger] ${JSON.stringify(toPublicJson(entry))}`);
}

/**
 * Optional external POST for Bedrock Dedicated Server setups.
 * Intentionally a no-op unless httpEndpoint is set and fetch exists.
 * @param {LogEntry} entry
 */
function maybeHttp(entry) {
  const endpoint = CONFIG.httpEndpoint;
  if (!endpoint) return;

  // Global fetch is not available in standard Script API.
  // BDS packs that add networking should replace this hook.
  try {
    // @ts-ignore
    if (typeof fetch === "function") {
      // @ts-ignore
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPublicJson(entry)),
      });
    }
  } catch (err) {
    console.warn(`[BlockLogger] HTTP log failed: ${err}`);
  }
}

/**
 * Subscribe to place/break after-events.
 */
export function registerLoggerEvents() {
  world.afterEvents.playerBreakBlock.subscribe(onPlayerBreakBlock);

  // playerPlaceBlock is available on current @minecraft/server releases.
  // Guard so older runtimes fail gracefully for place logging only.
  const after = world.afterEvents;
  if (after.playerPlaceBlock) {
    after.playerPlaceBlock.subscribe(onPlayerPlaceBlock);
  } else {
    console.warn(
      "[BlockLogger] afterEvents.playerPlaceBlock is unavailable on this engine; place logging disabled."
    );
  }
}
