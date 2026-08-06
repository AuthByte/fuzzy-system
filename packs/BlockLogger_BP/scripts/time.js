/**
 * Time helpers for BlockLogger.
 */

/**
 * @returns {number} Unix epoch milliseconds.
 */
export function nowMs() {
  return Date.now();
}

/**
 * Format a timestamp for chat display.
 * @param {number} ms
 * @returns {string}
 */
export function formatTime(ms) {
  try {
    return new Date(ms).toISOString().replace(".000Z", "Z");
  } catch {
    return String(ms);
  }
}

/**
 * Parse human durations like 30s, 5m, 2h, 1d, 1w.
 * Also accepts plain integers as minutes.
 * @param {string|number|undefined} input
 * @returns {number|undefined} Duration in milliseconds, or undefined if invalid.
 */
export function parseDuration(input) {
  if (input === undefined || input === null || input === "") return undefined;

  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.max(0, Math.floor(input)) * 60_000;
  }

  const text = String(input).trim().toLowerCase();
  if (!text) return undefined;

  const match = /^(\d+)\s*([smhdw])?$/.exec(text);
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;

  const unit = match[2] ?? "m";
  const multipliers = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };

  return amount * multipliers[unit];
}

/**
 * Relative age string, e.g. "3m ago".
 * @param {number} ms
 * @param {number} [relativeTo]
 * @returns {string}
 */
export function formatAge(ms, relativeTo = nowMs()) {
  const delta = Math.max(0, relativeTo - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
