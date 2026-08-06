import { neon } from "@neondatabase/serverless";
import { get, put } from "@vercel/blob";
import type { LogEvent, LogFilters, QueryResult, Stats } from "./types";

const BLOB_PATH = "blocklogger/logs.json";

type StoredRow = {
  id: number;
  time_ms: number;
  player: string;
  action: "placed" | "broken";
  block: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  states_json?: string | null;
  source?: string;
};

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  return neon(url);
}

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function storageMode(): "neon" | "blob" | "none" {
  if (getSql()) return "neon";
  if (hasBlob()) return "blob";
  return "none";
}

export async function ensureSchema() {
  const sql = getSql();
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS logs (
      id BIGSERIAL PRIMARY KEY,
      time_ms BIGINT NOT NULL,
      player TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('placed', 'broken')),
      block TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      z INTEGER NOT NULL,
      dimension TEXT NOT NULL,
      states_json TEXT,
      source TEXT DEFAULT 'addon',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time_ms DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_logs_player ON logs(player)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_logs_coords ON logs(x, y, z)`;
}

function normalizeAction(raw: unknown): "placed" | "broken" {
  if (raw === "placed" || raw === "p") return "placed";
  if (raw === "broken" || raw === "b" || raw === "broke") return "broken";
  throw new Error(`Invalid action: ${String(raw)}`);
}

export function normalizeLog(input: Record<string, unknown>): Omit<StoredRow, "id"> {
  const location = (input.location as Record<string, unknown> | undefined) ?? {};
  const x = Number(input.x ?? location.x);
  const y = Number(input.y ?? location.y);
  const z = Number(input.z ?? location.z);
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error("Coordinates x/y/z are required");
  }

  let timeMs: number;
  if (typeof input.time_ms === "number") timeMs = input.time_ms;
  else if (typeof input.t === "number") timeMs = input.t;
  else if (typeof input.time === "string") timeMs = Date.parse(input.time);
  else timeMs = Date.now();
  if (!Number.isFinite(timeMs)) timeMs = Date.now();

  const player = String(input.player ?? input.p ?? "").trim();
  const block = String(input.block ?? input.b ?? "").trim();
  if (!player) throw new Error("player is required");
  if (!block) throw new Error("block is required");

  const states = (input.states ?? input.s) as
    | Record<string, string | number | boolean>
    | undefined;

  return {
    time_ms: Math.floor(timeMs),
    player,
    action: normalizeAction(input.action ?? input.a),
    block,
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    dimension: String(input.dimension ?? input.d ?? "minecraft:overworld").trim(),
    states_json: states ? JSON.stringify(states) : null,
    source: String(input.source ?? "addon"),
  };
}

function rowToEvent(row: StoredRow): LogEvent {
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

async function readBlobRows(): Promise<StoredRow[]> {
  try {
    const result = await get(BLOB_PATH, { access: "private", useCache: false });
    if (!result?.stream) return [];
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeBlobRows(rows: StoredRow[]) {
  await put(BLOB_PATH, JSON.stringify(rows), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function insertLogs(
  items: Record<string, unknown>[]
): Promise<LogEvent[]> {
  const mode = storageMode();
  if (mode === "none") {
    throw new Error(
      "No storage configured. Set DATABASE_URL (Neon) or BLOB_READ_WRITE_TOKEN on Vercel."
    );
  }

  const rows = items.map((item) => normalizeLog(item));

  if (mode === "neon") {
    await ensureSchema();
    const sql = getSql()!;
    const out: LogEvent[] = [];
    for (const row of rows) {
      const inserted = await sql`
        INSERT INTO logs (time_ms, player, action, block, x, y, z, dimension, states_json, source)
        VALUES (
          ${row.time_ms}, ${row.player}, ${row.action}, ${row.block},
          ${row.x}, ${row.y}, ${row.z}, ${row.dimension}, ${row.states_json}, ${row.source}
        )
        RETURNING id, time_ms, player, action, block, x, y, z, dimension, states_json, source
      `;
      out.push(rowToEvent(inserted[0] as StoredRow));
    }
    return out;
  }

  const existing = await readBlobRows();
  let nextId = existing.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const added = rows.map((row) => ({ ...row, id: nextId++ }));
  const merged = [...existing, ...added].slice(-20000);
  await writeBlobRows(merged);
  return added.map(rowToEvent);
}

function applyFilters(rows: StoredRow[], filters: LogFilters): StoredRow[] {
  return rows.filter((row) => {
    if (filters.player && row.player.toLowerCase() !== filters.player.toLowerCase()) {
      return false;
    }
    if (filters.action && row.action !== filters.action) return false;
    if (filters.dimension && row.dimension !== filters.dimension) return false;
    if (filters.block && !row.block.toLowerCase().includes(filters.block.toLowerCase())) {
      return false;
    }
    if (filters.from !== undefined && row.time_ms < filters.from) return false;
    if (filters.to !== undefined && row.time_ms > filters.to) return false;
    if (
      filters.x !== undefined &&
      filters.y !== undefined &&
      filters.z !== undefined &&
      Number.isFinite(filters.x) &&
      Number.isFinite(filters.y) &&
      Number.isFinite(filters.z)
    ) {
      const radius = Math.max(0, filters.radius ?? 0);
      const dx = row.x - filters.x;
      const dy = row.y - filters.y;
      const dz = row.z - filters.z;
      if (dx * dx + dy * dy + dz * dz > radius * radius) return false;
    }
    return true;
  });
}

export async function queryLogs(filters: LogFilters = {}): Promise<QueryResult> {
  const mode = storageMode();
  if (mode === "none") {
    return { total: 0, limit: 100, offset: 0, items: [] };
  }

  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 1000);
  const offset = Math.max(Number(filters.offset ?? 0), 0);

  if (mode === "blob") {
    const all = applyFilters(await readBlobRows(), filters).sort(
      (a, b) => b.time_ms - a.time_ms || b.id - a.id
    );
    return {
      total: all.length,
      limit,
      offset,
      items: all.slice(offset, offset + limit).map(rowToEvent),
    };
  }

  await ensureSchema();
  const sql = getSql()!;

  // Neon tagged templates don't love fully dynamic WHERE easily;
  // fetch a bounded recent window then filter in process for simplicity at this scale,
  // or use a few dedicated query shapes. For correctness + filters, use SQL with optional clauses via raw building carefully.
  const recent = (await sql`
    SELECT id, time_ms, player, action, block, x, y, z, dimension, states_json, source
    FROM logs
    ORDER BY time_ms DESC, id DESC
    LIMIT 20000
  `) as StoredRow[];

  const filtered = applyFilters(recent, filters);
  return {
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit).map(rowToEvent),
  };
}

export async function getStats(): Promise<Stats> {
  const mode = storageMode();
  if (mode === "none") {
    return {
      total: 0,
      placed: 0,
      broken: 0,
      players: 0,
      topPlayers24h: [],
      activityByHour: [],
    };
  }

  const rows =
    mode === "blob"
      ? await readBlobRows()
      : ((await getSql()!`
          SELECT id, time_ms, player, action, block, x, y, z, dimension, states_json, source
          FROM logs
        `) as StoredRow[]);

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const players = new Set(rows.map((r) => r.player));
  const placed = rows.filter((r) => r.action === "placed").length;
  const broken = rows.filter((r) => r.action === "broken").length;

  const topMap = new Map<string, number>();
  for (const row of rows) {
    if (row.time_ms < since) continue;
    topMap.set(row.player, (topMap.get(row.player) ?? 0) + 1);
  }
  const topPlayers24h = [...topMap.entries()]
    .map(([player, c]) => ({ player, c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8);

  const hourMap = new Map<number, number>();
  for (const row of rows) {
    if (row.time_ms < since) continue;
    const bucket = Math.floor(row.time_ms / 3_600_000);
    hourMap.set(bucket, (hourMap.get(bucket) ?? 0) + 1);
  }
  const activityByHour = [...hourMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, count]) => ({
      hour: new Date(bucket * 3_600_000).toISOString(),
      count,
    }));

  return {
    total: rows.length,
    placed,
    broken,
    players: players.size,
    topPlayers24h,
    activityByHour,
  };
}

export async function listPlayers() {
  const { items } = await queryLogs({ limit: 20000, offset: 0 });
  const map = new Map<string, { count: number; lastSeen: number }>();
  for (const item of items) {
    const prev = map.get(item.player);
    if (!prev) {
      map.set(item.player, { count: 1, lastSeen: item.time_ms });
    } else {
      prev.count += 1;
      prev.lastSeen = Math.max(prev.lastSeen, item.time_ms);
    }
  }
  return [...map.entries()]
    .map(([player, v]) => ({
      player,
      count: v.count,
      lastSeen: new Date(v.lastSeen).toISOString(),
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
