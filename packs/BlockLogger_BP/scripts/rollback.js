import { BlockPermutation, system, world } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { filterEntries, nextRollbackId, replaceEntries } from "./storage.js";
import { nowMs } from "./time.js";

/**
 * @typedef {import("./format.js").LogEntry} LogEntry
 * @typedef {import("@minecraft/server").Player} Player
 */

/**
 * @param {string} dimensionId
 * @returns {import("@minecraft/server").Dimension | undefined}
 */
function getDimension(dimensionId) {
  try {
    return world.getDimension(dimensionId);
  } catch {
    // Fallbacks for short ids
    try {
      if (dimensionId.includes("nether")) return world.getDimension("nether");
      if (dimensionId.includes("the_end") || dimensionId.includes("end")) {
        return world.getDimension("the_end");
      }
      return world.getDimension("overworld");
    } catch {
      return undefined;
    }
  }
}

/**
 * Apply the inverse of a logged action.
 * placed  -> air
 * broken  -> restore block + states
 * @param {LogEntry} entry
 * @returns {boolean}
 */
function applyInverse(entry) {
  const dimension = getDimension(entry.d);
  if (!dimension) return false;

  const block = dimension.getBlock({ x: entry.x, y: entry.y, z: entry.z });
  if (!block) return false;

  try {
    if (entry.a === "p") {
      block.setType("minecraft:air");
      return true;
    }

    if (entry.a === "b" || entry.a === "e") {
      if (entry.s && Object.keys(entry.s).length) {
        block.setPermutation(BlockPermutation.resolve(entry.b, entry.s));
      } else {
        block.setType(entry.b);
      }
      return true;
    }

    if (entry.a === "o" || entry.a === "k" || entry.a === "h") {
      // Opens / kills / hits have no block inverse.
      return false;
    }

    if (entry.a === "f") {
      // Extinguish fire / clear ignited fire block. Campfires/TNT left as best-effort.
      if (
        block.typeId === "minecraft:fire" ||
        block.typeId === "minecraft:soul_fire" ||
        entry.b === "minecraft:fire" ||
        entry.b === "minecraft:soul_fire"
      ) {
        block.setType("minecraft:air");
        return true;
      }
      if (block.typeId.includes("campfire")) {
        // Can't reliably un-light via stable API in all versions — remove fire overlay only.
        return false;
      }
      return false;
    }
  } catch (err) {
    console.warn(`[BlockLogger] Failed to apply inverse for #${entry.i}: ${err}`);
  }
  return false;
}

/**
 * Re-apply the original action (undo a rollback).
 * @param {LogEntry} entry
 * @returns {boolean}
 */
function applyForward(entry) {
  const dimension = getDimension(entry.d);
  if (!dimension) return false;

  const block = dimension.getBlock({ x: entry.x, y: entry.y, z: entry.z });
  if (!block) return false;

  try {
    if (entry.a === "p") {
      if (entry.s && Object.keys(entry.s).length) {
        block.setPermutation(BlockPermutation.resolve(entry.b, entry.s));
      } else {
        block.setType(entry.b);
      }
      return true;
    }

    if (entry.a === "b" || entry.a === "e") {
      block.setType("minecraft:air");
      return true;
    }

    if (entry.a === "o" || entry.a === "k" || entry.a === "h") {
      return false;
    }

    if (entry.a === "f") {
      const fireId =
        entry.b === "minecraft:soul_fire" ? "minecraft:soul_fire" : "minecraft:fire";
      if (
        entry.b === "minecraft:fire" ||
        entry.b === "minecraft:soul_fire" ||
        block.isAir
      ) {
        block.setType(fireId);
        return true;
      }
      return false;
    }
  } catch (err) {
    console.warn(`[BlockLogger] Failed to re-apply #${entry.i}: ${err}`);
  }
  return false;
}

/**
 * @param {object} opts
 * @param {string} [opts.playerName]
 * @param {number} opts.sinceMs
 * @param {number} [opts.cx]
 * @param {number} [opts.cy]
 * @param {number} [opts.cz]
 * @param {number} [opts.radius]
 * @param {string} [opts.dimensionId]
 * @returns {LogEntry[]}
 */
export function findRollbackCandidates(opts) {
  const sinceMs = opts.sinceMs;
  const playerName = opts.playerName?.toLowerCase();
  const radius = opts.radius;
  const hasCenter =
    opts.cx !== undefined && opts.cy !== undefined && opts.cz !== undefined;

  return filterEntries((entry) => {
    if (entry.r !== undefined) return false; // already rolled back
    if (entry.t < sinceMs) return false;
    if (playerName && entry.p.toLowerCase() !== playerName) return false;
    if (opts.dimensionId && entry.d !== opts.dimensionId) return false;
    if (hasCenter && radius !== undefined) {
      const dx = entry.x - /** @type {number} */ (opts.cx);
      const dy = entry.y - /** @type {number} */ (opts.cy);
      const dz = entry.z - /** @type {number} */ (opts.cz);
      if (dx * dx + dy * dy + dz * dz > radius * radius) return false;
    }
    return true;
  });
}

/**
 * Rollback matching entries (newest first so layered changes unwind correctly).
 * @param {Player} actor
 * @param {LogEntry[]} candidates
 * @returns {void}
 */
export function runRollback(actor, candidates) {
  const limited = candidates
    .slice()
    .sort((a, b) => b.t - a.t || b.i - a.i)
    .slice(0, CONFIG.maxRollbackBlocks);

  if (!limited.length) {
    actor.sendMessage("§e[BlockLogger] Nothing to rollback.");
    return;
  }

  const rollbackId = nextRollbackId();
  actor.sendMessage(
    `§a[BlockLogger] Rolling back §f${limited.length}§a change(s) (batch §f#${rollbackId}§a)...`
  );

  system.runJob(
    (function* () {
      let changed = 0;
      let failed = 0;
      const idSet = new Set(limited.map((e) => e.i));

      for (let i = 0; i < limited.length; i++) {
        const ok = applyInverse(limited[i]);
        if (ok) changed++;
        else failed++;
        if (i % CONFIG.rollbackBatchSize === 0) yield;
      }

      // Mark rolled-back entries in storage
      const all = filterEntries(() => true).map((entry) =>
        idSet.has(entry.i) ? { ...entry, r: rollbackId } : entry
      );
      replaceEntries(all);

      actor.sendMessage(
        `§a[BlockLogger] Rollback #${rollbackId} done. §f${changed}§a applied` +
          (failed ? `, §c${failed}§a failed (chunks unloaded?)` : "") +
          `. Use §f/${CONFIG.namespace}:restore ${rollbackId}§a to undo.`
      );
    })()
  );
}

/**
 * Restore a previous rollback batch.
 * @param {Player} actor
 * @param {number} rollbackId
 */
export function runRestore(actor, rollbackId) {
  const candidates = filterEntries((e) => e.r === rollbackId)
    .slice()
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .slice(0, CONFIG.maxRollbackBlocks);

  if (!candidates.length) {
    actor.sendMessage(`§e[BlockLogger] No entries found for rollback #${rollbackId}.`);
    return;
  }

  actor.sendMessage(
    `§a[BlockLogger] Restoring batch §f#${rollbackId}§a (§f${candidates.length}§a)...`
  );

  system.runJob(
    (function* () {
      let changed = 0;
      let failed = 0;
      const idSet = new Set(candidates.map((e) => e.i));

      for (let i = 0; i < candidates.length; i++) {
        const ok = applyForward(candidates[i]);
        if (ok) changed++;
        else failed++;
        if (i % CONFIG.rollbackBatchSize === 0) yield;
      }

      const all = filterEntries(() => true).map((entry) => {
        if (!idSet.has(entry.i)) return entry;
        const { r, ...rest } = entry;
        return rest;
      });
      replaceEntries(all);

      actor.sendMessage(
        `§a[BlockLogger] Restore #${rollbackId} done. §f${changed}§a applied` +
          (failed ? `, §c${failed}§a failed` : "") +
          "."
      );
    })()
  );
}

/**
 * Convenience: rollback a player's actions within a duration.
 * @param {Player} actor
 * @param {string} playerName
 * @param {number} durationMs
 */
export function rollbackPlayerSince(actor, playerName, durationMs) {
  const sinceMs = nowMs() - durationMs;
  const candidates = findRollbackCandidates({ playerName, sinceMs });
  runRollback(actor, candidates);
}
