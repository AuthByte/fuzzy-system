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
  exportEntry(entry);
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
  exportEntry(entry);
}

/**
 * Emit structured console lines for the BDS bridge and optional HTTP.
 * @param {LogEntry} entry
 */
function exportEntry(entry) {
  const pub = toPublicJson(entry);

  if (CONFIG.debugConsole || CONFIG.bridgeConsole) {
    // tools/bds-bridge.mjs scrapes lines containing BLJSON:
    console.warn(`BLJSON:${JSON.stringify(pub)}`);
  }

  maybeHttp(pub);
}

/**
 * Optional direct HTTP POST (BDS with networking / custom runtime).
 * Prefer the console + bds-bridge path to avoid Beta APIs.
 * @param {object} pub
 */
function maybeHttp(pub) {
  const endpoint = CONFIG.httpEndpoint;
  if (!endpoint) return;

  try {
    // @ts-ignore — fetch is not part of stock Script API
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
 * Subscribe to place/break after-events.
 */
export function registerLoggerEvents() {
  world.afterEvents.playerBreakBlock.subscribe(onPlayerBreakBlock);

  const after = world.afterEvents;
  if (after.playerPlaceBlock) {
    after.playerPlaceBlock.subscribe(onPlayerPlaceBlock);
  } else {
    console.warn(
      "[BlockLogger] afterEvents.playerPlaceBlock is unavailable on this engine; place logging disabled."
    );
  }
}
