import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";

const META_KEY = "bl_meta";
const CHUNK_PREFIX = "bl_c_";

/**
 * @typedef {import("./format.js").LogEntry} LogEntry
 */

/**
 * @typedef {object} Meta
 * @property {number} nextId
 * @property {number} chunks
 * @property {number} count
 * @property {number} nextRollbackId
 */

/** @type {LogEntry[] | null} */
let cache = null;

/** @type {Meta | null} */
let metaCache = null;

/**
 * @returns {Meta}
 */
function defaultMeta() {
  return { nextId: 1, chunks: 0, count: 0, nextRollbackId: 1 };
}

/**
 * @returns {Meta}
 */
export function getMeta() {
  if (metaCache) return metaCache;
  const raw = world.getDynamicProperty(META_KEY);
  if (typeof raw !== "string" || !raw) {
    metaCache = defaultMeta();
    return metaCache;
  }
  try {
    metaCache = { ...defaultMeta(), ...JSON.parse(raw) };
  } catch {
    metaCache = defaultMeta();
  }
  return metaCache;
}

/**
 * @param {Meta} meta
 */
function saveMeta(meta) {
  metaCache = meta;
  world.setDynamicProperty(META_KEY, JSON.stringify(meta));
}

/**
 * Load all entries into memory (lazy).
 * @returns {LogEntry[]}
 */
export function getAllEntries() {
  if (cache) return cache;
  const meta = getMeta();
  /** @type {LogEntry[]} */
  const entries = [];
  for (let i = 0; i < meta.chunks; i++) {
    const raw = world.getDynamicProperty(CHUNK_PREFIX + i);
    if (typeof raw !== "string" || !raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) entries.push(item);
      }
    } catch {
      // skip corrupt chunk
    }
  }
  cache = entries;
  return cache;
}

/**
 * Persist the in-memory entry list into chunked dynamic properties.
 * @param {LogEntry[]} entries
 */
function persistEntries(entries) {
  const limit = CONFIG.chunkCharLimit;
  /** @type {string[]} */
  const chunks = [];
  /** @type {LogEntry[]} */
  let current = [];
  let currentLen = 2; // [] 

  for (const entry of entries) {
    const piece = JSON.stringify(entry);
    const extra = current.length === 0 ? piece.length : piece.length + 1; // comma
    if (current.length > 0 && currentLen + extra > limit) {
      chunks.push(JSON.stringify(current));
      current = [];
      currentLen = 2;
    }
    current.push(entry);
    currentLen += extra;
  }
  if (current.length > 0 || chunks.length === 0) {
    chunks.push(JSON.stringify(current));
  }

  const meta = getMeta();
  const oldChunks = meta.chunks;

  for (let i = 0; i < chunks.length; i++) {
    world.setDynamicProperty(CHUNK_PREFIX + i, chunks[i]);
  }
  for (let i = chunks.length; i < oldChunks; i++) {
    world.setDynamicProperty(CHUNK_PREFIX + i, undefined);
  }

  meta.chunks = chunks.length;
  meta.count = entries.length;
  saveMeta(meta);
  cache = entries;
}

/**
 * Append a log entry and prune if over capacity.
 * @param {Omit<LogEntry, "i">} partial
 * @returns {LogEntry}
 */
export function appendEntry(partial) {
  const meta = getMeta();
  /** @type {LogEntry} */
  const entry = { ...partial, i: meta.nextId++ };
  const entries = getAllEntries();
  entries.push(entry);

  if (CONFIG.maxEntries > 0) {
    while (entries.length > CONFIG.maxEntries) {
      entries.shift();
    }
  }

  persistEntries(entries);
  saveMeta(meta);
  return entry;
}

/**
 * Replace all entries (used after marking rollbacks).
 * @param {LogEntry[]} entries
 * @param {Partial<Meta>} [metaPatch]
 */
export function replaceEntries(entries, metaPatch = {}) {
  const meta = getMeta();
  Object.assign(meta, metaPatch);
  persistEntries(entries);
  saveMeta(meta);
}

/**
 * Allocate a rollback batch id.
 * @returns {number}
 */
export function nextRollbackId() {
  const meta = getMeta();
  const id = meta.nextRollbackId++;
  saveMeta(meta);
  return id;
}

/**
 * Clear cache so the next read reloads from world storage.
 */
export function invalidateCache() {
  cache = null;
  metaCache = null;
}

/**
 * Query helpers.
 * @param {(entry: LogEntry) => boolean} predicate
 * @param {{ limit?: number, newestFirst?: boolean }} [opts]
 * @returns {LogEntry[]}
 */
export function queryEntries(predicate, opts = {}) {
  const unlimited = opts.limit === 0 || opts.limit === Infinity || opts.unlimited === true;
  const limit = unlimited ? Infinity : (opts.limit ?? CONFIG.lookupLimit);
  const newestFirst = opts.newestFirst !== false;
  const entries = getAllEntries();
  /** @type {LogEntry[]} */
  const matches = [];

  if (newestFirst) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!predicate(entry)) continue;
      matches.push(entry);
      if (matches.length >= limit) break;
    }
  } else {
    for (const entry of entries) {
      if (!predicate(entry)) continue;
      matches.push(entry);
      if (matches.length >= limit) break;
    }
  }

  return matches;
}

/**
 * Filter without limit (used by rollback).
 * @param {(entry: LogEntry) => boolean} predicate
 * @returns {LogEntry[]}
 */
export function filterEntries(predicate) {
  return getAllEntries().filter(predicate);
}
