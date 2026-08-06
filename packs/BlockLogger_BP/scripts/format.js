/**
 * Compact log entry helpers.
 *
 * Stored shape (compact keys to fit more entries in dynamic properties):
 * {
 *   i: number,          // id
 *   t: number,          // unix ms
 *   p: string,          // player / actor name
 *   a: "p"|"b"|"f"|"e"|"o"|"k"|"h", // placed|broken|ignited|exploded|opened|killed|hit
 *   b: string,          // block / entity type id
 *   x: number, y: number, z: number,
 *   d: string,          // dimension id
 *   s?: object,         // block states (for restore on broken/exploded)
 *   r?: number,         // rollback batch id (if this entry was rolled back)
 *   c?: number,         // collapsed count (mining bursts)
 *   tool?: string       // item / source used (flint_and_steel, tnt, …)
 * }
 */

/**
 * @typedef {object} LogEntry
 * @property {number} i
 * @property {number} t
 * @property {string} p
 * @property {"p"|"b"|"f"|"e"|"o"|"k"|"h"} a
 * @property {string} b
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {string} d
 * @property {Record<string, boolean|number|string>=} s
 * @property {number=} r
 * @property {number=} c
 * @property {string=} tool
 */

/** @type {Record<string, string>} */
const ACTION_PUBLIC = {
  p: "placed",
  b: "broken",
  f: "ignited",
  e: "exploded",
  o: "opened",
  k: "killed",
  h: "hit",
};

/** @type {Record<string, string>} */
const ACTION_CHAT = {
  p: "placed",
  b: "broke",
  f: "ignited",
  e: "exploded",
  o: "opened",
  k: "killed",
  h: "hit",
};

/**
 * @param {LogEntry} entry
 * @returns {object}
 */
export function toPublicJson(entry) {
  const action = ACTION_PUBLIC[entry.a] ?? "broken";
  return {
    id: entry.i,
    time: new Date(entry.t).toISOString(),
    player: entry.p,
    action,
    block: entry.b,
    location: { x: entry.x, y: entry.y, z: entry.z },
    dimension: entry.d,
    ...(entry.c && entry.c > 1 ? { count: entry.c } : {}),
    ...(entry.tool ? { tool: entry.tool } : {}),
    ...(entry.s && Object.keys(entry.s).length ? { states: entry.s } : {}),
    ...(entry.r !== undefined ? { rollbackId: entry.r } : {}),
  };
}

/**
 * One-line chat summary.
 * @param {LogEntry} entry
 * @param {{ includeAge?: boolean, now?: number }} [opts]
 * @returns {string}
 */
export function formatEntryLine(entry, opts = {}) {
  const action = ACTION_CHAT[entry.a] ?? "broke";
  const count = entry.c && entry.c > 1 ? `§e${entry.c}x ` : "";
  const loc = `${entry.x} ${entry.y} ${entry.z}`;
  const dim = shortDimension(entry.d);
  const tool = entry.tool
    ? ` §8with §7${String(entry.tool).replace("minecraft:", "")}`
    : "";
  let line = `§7#${entry.i} §f${entry.p} §e${action} ${count}§b${entry.b}${tool} §7@ §f${loc} §8(${dim})`;
  if (opts.includeAge !== false) {
    const ageMs = (opts.now ?? Date.now()) - entry.t;
    line += ` §8· §7${formatShortAge(ageMs)}`;
  }
  return line;
}

/**
 * @param {string} dimensionId
 * @returns {string}
 */
export function shortDimension(dimensionId) {
  if (!dimensionId) return "?";
  if (dimensionId.endsWith("overworld")) return "OW";
  if (dimensionId.endsWith("nether")) return "Nether";
  if (dimensionId.endsWith("the_end")) return "End";
  return dimensionId.replace("minecraft:", "");
}

/**
 * @param {number} ageMs
 * @returns {string}
 */
function formatShortAge(ageMs) {
  const sec = Math.floor(Math.max(0, ageMs) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Snapshot block states for later restore.
 * @param {{ getAllStates?: () => Record<string, boolean|number|string> } | undefined} permutation
 * @returns {Record<string, boolean|number|string>|undefined}
 */
export function snapshotStates(permutation) {
  if (!permutation || typeof permutation.getAllStates !== "function") return undefined;
  try {
    const states = permutation.getAllStates();
    if (!states || typeof states !== "object") return undefined;
    const keys = Object.keys(states);
    if (!keys.length) return undefined;
    return { ...states };
  } catch {
    return undefined;
  }
}
