import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.BLOCKLOGGER_DB || path.join(dataDir, "blocklogger.sqlite");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_ms INTEGER NOT NULL,
    player TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('placed', 'broken')),
    block TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    z INTEGER NOT NULL,
    dimension TEXT NOT NULL,
    states_json TEXT,
    source TEXT DEFAULT 'addon',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_player ON logs(player);
  CREATE INDEX IF NOT EXISTS idx_logs_coords ON logs(x, y, z);
  CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
  CREATE INDEX IF NOT EXISTS idx_logs_dimension ON logs(dimension);
`);

const insertStmt = db.prepare(`
  INSERT INTO logs (time_ms, player, action, block, x, y, z, dimension, states_json, source)
  VALUES (@time_ms, @player, @action, @block, @x, @y, @z, @dimension, @states_json, @source)
`);

/**
 * Normalize an inbound log payload into a DB row.
 * Accepts public JSON shape or compact bridge shape.
 */
export function normalizeLog(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Log payload must be an object");
  }

  const actionRaw = input.action ?? input.a;
  let action;
  if (actionRaw === "placed" || actionRaw === "p") action = "placed";
  else if (actionRaw === "broken" || actionRaw === "b" || actionRaw === "broke") action = "broken";
  else throw new Error(`Invalid action: ${actionRaw}`);

  const location = input.location ?? {};
  const x = Number(input.x ?? location.x);
  const y = Number(input.y ?? location.y);
  const z = Number(input.z ?? location.z);
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error("Coordinates x/y/z are required");
  }

  let timeMs;
  if (typeof input.time_ms === "number") timeMs = input.time_ms;
  else if (typeof input.t === "number") timeMs = input.t;
  else if (typeof input.time === "string") timeMs = Date.parse(input.time);
  else timeMs = Date.now();
  if (!Number.isFinite(timeMs)) timeMs = Date.now();

  const player = String(input.player ?? input.p ?? "").trim();
  const block = String(input.block ?? input.b ?? "").trim();
  if (!player) throw new Error("player is required");
  if (!block) throw new Error("block is required");

  const dimension = String(
    input.dimension ?? input.d ?? "minecraft:overworld"
  ).trim();

  const states = input.states ?? input.s ?? null;

  return {
    time_ms: Math.floor(timeMs),
    player,
    action,
    block,
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    dimension,
    states_json: states ? JSON.stringify(states) : null,
    source: String(input.source ?? "addon"),
  };
}

export function insertLog(input) {
  const row = normalizeLog(input);
  const info = insertStmt.run(row);
  return { id: Number(info.lastInsertRowid), ...row };
}

export function insertLogs(items) {
  if (!Array.isArray(items)) throw new Error("Expected an array of logs");
  const insertMany = db.transaction((rows) => rows.map((row) => insertLog(row)));
  return insertMany(items);
}

export function queryLogs(filters = {}) {
  const where = [];
  const params = {};

  if (filters.player) {
    where.push("LOWER(player) = LOWER(@player)");
    params.player = String(filters.player);
  }
  if (filters.action) {
    where.push("action = @action");
    params.action = String(filters.action);
  }
  if (filters.dimension) {
    where.push("dimension = @dimension");
    params.dimension = String(filters.dimension);
  }
  if (filters.block) {
    where.push("block LIKE @block");
    params.block = `%${String(filters.block)}%`;
  }
  if (filters.from) {
    where.push("time_ms >= @from");
    params.from = Number(filters.from);
  }
  if (filters.to) {
    where.push("time_ms <= @to");
    params.to = Number(filters.to);
  }

  const hasCenter =
    filters.x !== undefined &&
    filters.y !== undefined &&
    filters.z !== undefined &&
    filters.x !== "" &&
    filters.y !== "" &&
    filters.z !== "";

  if (hasCenter) {
    const radius = Math.max(0, Number(filters.radius ?? 0));
    params.cx = Math.floor(Number(filters.x));
    params.cy = Math.floor(Number(filters.y));
    params.cz = Math.floor(Number(filters.z));
    params.r2 = radius * radius;
    where.push(
      "((x - @cx) * (x - @cx) + (y - @cy) * (y - @cy) + (z - @cz) * (z - @cz)) <= @r2"
    );
  }

  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 1000);
  const offset = Math.max(Number(filters.offset ?? 0), 0);
  params.limit = limit;
  params.offset = offset;

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, time_ms, player, action, block, x, y, z, dimension, states_json, source, created_at
       FROM logs
       ${whereSql}
       ORDER BY time_ms DESC, id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(params);

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM logs ${whereSql}`)
    .get(params).c;

  return {
    total,
    limit,
    offset,
    items: rows.map(serializeRow),
  };
}

function serializeRow(row) {
  return {
    id: row.id,
    time: new Date(row.time_ms).toISOString(),
    time_ms: row.time_ms,
    player: row.player,
    action: row.action,
    block: row.block,
    location: { x: row.x, y: row.y, z: row.z },
    dimension: row.dimension,
    states: row.states_json ? JSON.parse(row.states_json) : undefined,
    source: row.source,
  };
}

export function getStats() {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN action = 'placed' THEN 1 ELSE 0 END) AS placed,
         SUM(CASE WHEN action = 'broken' THEN 1 ELSE 0 END) AS broken,
         COUNT(DISTINCT player) AS players
       FROM logs`
    )
    .get();

  const recent = db
    .prepare(
      `SELECT player, COUNT(*) AS c
       FROM logs
       WHERE time_ms >= @since
       GROUP BY player
       ORDER BY c DESC
       LIMIT 8`
    )
    .all({ since: Date.now() - 24 * 60 * 60 * 1000 });

  const byHour = db
    .prepare(
      `SELECT CAST((time_ms / 3600000) AS INTEGER) AS hour_bucket, COUNT(*) AS c
       FROM logs
       WHERE time_ms >= @since
       GROUP BY hour_bucket
       ORDER BY hour_bucket`
    )
    .all({ since: Date.now() - 24 * 60 * 60 * 1000 });

  return {
    total: totals.total ?? 0,
    placed: totals.placed ?? 0,
    broken: totals.broken ?? 0,
    players: totals.players ?? 0,
    topPlayers24h: recent,
    activityByHour: byHour.map((r) => ({
      hour: new Date(r.hour_bucket * 3600000).toISOString(),
      count: r.c,
    })),
  };
}

export function listPlayers() {
  return db
    .prepare(
      `SELECT player, COUNT(*) AS count, MAX(time_ms) AS last_seen
       FROM logs
       GROUP BY player
       ORDER BY last_seen DESC`
    )
    .all()
    .map((r) => ({
      player: r.player,
      count: r.count,
      lastSeen: new Date(r.last_seen).toISOString(),
    }));
}
