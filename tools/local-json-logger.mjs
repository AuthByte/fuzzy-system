#!/usr/bin/env node
/**
 * Save BlockLogger events as JSON files on disk.
 *
 * Minecraft Bedrock scripts cannot write arbitrary folders on your PC/phone.
 * This helper runs on your computer and writes:
 *
 *   logs/blocklogger/
 *     events.jsonl          # append-only, one JSON object per line
 *     2026-08-06.json       # all events for that UTC day (array)
 *     latest.json           # last N events (array)
 *
 * Usage:
 *   # From BDS console pipe
 *   ./bedrock_server 2>&1 | node tools/local-json-logger.mjs
 *
 *   # From a pasted dump file
 *   node tools/local-json-logger.mjs --import dump.json
 *
 *   # From stdin paste (Ctrl+D when done)
 *   node tools/local-json-logger.mjs --import -
 *
 * Env:
 *   BLOCKLOGGER_LOG_DIR   default: <repo>/logs/blocklogger
 *   BLOCKLOGGER_LATEST_N  default: 500
 *   BLOCKLOGGER_URL       optional: also POST to hosted API
 *   BLOCKLOGGER_API_KEY   optional API key for POST
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR =
  process.env.BLOCKLOGGER_LOG_DIR || path.join(ROOT, "logs", "blocklogger");
const LATEST_N = Math.max(1, Number(process.env.BLOCKLOGGER_LATEST_N || 500));
const ENDPOINT = process.env.BLOCKLOGGER_URL || "";
const API_KEY = process.env.BLOCKLOGGER_API_KEY || "";
const MARKER = "BLJSON:";

fs.mkdirSync(LOG_DIR, { recursive: true });

const eventsPath = path.join(LOG_DIR, "events.jsonl");
const latestPath = path.join(LOG_DIR, "latest.json");

function dayFile(timeMs) {
  const day = new Date(timeMs).toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${day}.json`);
}

function normalize(input) {
  if (!input || typeof input !== "object") throw new Error("invalid event");
  const location = input.location ?? {};
  const actionRaw = input.action ?? input.a;
  const action =
    actionRaw === "p" || actionRaw === "placed"
      ? "placed"
      : actionRaw === "b" || actionRaw === "broken" || actionRaw === "broke"
        ? "broken"
        : null;
  if (!action) throw new Error("invalid action");

  let timeMs =
    typeof input.time_ms === "number"
      ? input.time_ms
      : typeof input.t === "number"
        ? input.t
        : typeof input.time === "string"
          ? Date.parse(input.time)
          : Date.now();
  if (!Number.isFinite(timeMs)) timeMs = Date.now();

  const player = String(input.player ?? input.p ?? "").trim();
  const block = String(input.block ?? input.b ?? "").trim();
  const x = Number(input.x ?? location.x);
  const y = Number(input.y ?? location.y);
  const z = Number(input.z ?? location.z);
  if (!player || !block || ![x, y, z].every(Number.isFinite)) {
    throw new Error("missing player/block/coords");
  }

  return {
    time: new Date(timeMs).toISOString(),
    time_ms: Math.floor(timeMs),
    player,
    action,
    block,
    location: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
    dimension: String(input.dimension ?? input.d ?? "minecraft:overworld"),
    ...(input.states || input.s
      ? { states: input.states ?? input.s }
      : {}),
    source: String(input.source ?? "local-json"),
  };
}

function readJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(file, items) {
  fs.writeFileSync(file, JSON.stringify(items, null, 2) + "\n", "utf8");
}

let saved = 0;

async function maybePost(event) {
  if (!ENDPOINT) return;
  try {
    const headers = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-BlockLogger-Key"] = API_KEY;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      console.error(`[local-json] POST failed ${res.status}`);
    }
  } catch (err) {
    console.error(`[local-json] POST error: ${err.message || err}`);
  }
}

export async function saveEvent(raw) {
  const event = normalize(raw);
  fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");

  const dayPath = dayFile(event.time_ms);
  const dayItems = readJsonArray(dayPath);
  dayItems.push(event);
  writeJsonArray(dayPath, dayItems);

  const latest = readJsonArray(latestPath);
  latest.push(event);
  while (latest.length > LATEST_N) latest.shift();
  writeJsonArray(latestPath, latest);

  saved += 1;
  if (saved === 1 || saved % 25 === 0) {
    console.log(`[local-json] saved ${saved} → ${LOG_DIR}`);
  }

  await maybePost(event);
  return event;
}

function parseImportText(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.logs)) return parsed.logs;
    return [parsed];
  }
  const items = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const idx = s.indexOf(MARKER);
    const jsonText = idx >= 0 ? s.slice(idx + MARKER.length).trim() : s;
    items.push(JSON.parse(jsonText));
  }
  return items;
}

async function importFrom(source) {
  const text =
    source === "-"
      ? await readStdinAll()
      : fs.readFileSync(path.resolve(source), "utf8");
  const items = parseImportText(text);
  for (const item of items) {
    await saveEvent(item);
  }
  console.log(`[local-json] imported ${items.length} event(s) into ${LOG_DIR}`);
}

function readStdinAll() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function watchStdin() {
  console.log(`[local-json] writing to ${LOG_DIR}`);
  console.log(`[local-json] watching stdin for ${MARKER} lines`);
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const idx = line.indexOf(MARKER);
    if (idx === -1) continue;
    try {
      const payload = JSON.parse(line.slice(idx + MARKER.length).trim());
      await saveEvent({ ...payload, source: payload.source || "bds-console" });
    } catch (err) {
      console.error(`[local-json] bad line: ${err.message}`);
    }
  }
  console.log(`[local-json] done. total saved=${saved}`);
}

async function main() {
  const args = process.argv.slice(2);
  const importIdx = args.indexOf("--import");
  if (importIdx >= 0) {
    const source = args[importIdx + 1] || "-";
    await importFrom(source);
    return;
  }
  await watchStdin();
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
