#!/usr/bin/env node
/**
 * BDS → local JSON folder (+ optional hosted API)
 *
 * Writes Minecraft BlockLogger events to:
 *   logs/blocklogger/events.jsonl
 *   logs/blocklogger/YYYY-MM-DD.json
 *   logs/blocklogger/latest.json
 *
 * And optionally POSTs to a Vercel/API endpoint.
 *
 * Usage:
 *   ./bedrock_server 2>&1 | node tools/bds-bridge.mjs
 *   tail -F path/to/bds.log | node tools/bds-bridge.mjs
 *
 * Env:
 *   BLOCKLOGGER_LOG_DIR   default <repo>/logs/blocklogger
 *   BLOCKLOGGER_URL       e.g. https://your-app.vercel.app/api/logs
 *   BLOCKLOGGER_API_KEY   optional
 *   BLOCKLOGGER_LOCAL_ONLY=1  skip HTTP even if URL set
 */

import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { saveEvent } = await import(
  pathToFileURL(path.join(__dirname, "local-json-logger.mjs")).href
);

const MARKER = "BLJSON:";
const localOnly = process.env.BLOCKLOGGER_LOCAL_ONLY === "1";

if (localOnly) {
  delete process.env.BLOCKLOGGER_URL;
}

console.log(
  `[bridge] saving JSON under ${process.env.BLOCKLOGGER_LOG_DIR || path.join(__dirname, "..", "logs", "blocklogger")}`
);
if (process.env.BLOCKLOGGER_URL) {
  console.log(`[bridge] also posting to ${process.env.BLOCKLOGGER_URL}`);
} else {
  console.log("[bridge] local JSON only (set BLOCKLOGGER_URL to also sync to Vercel)");
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let count = 0;

for await (const line of rl) {
  const idx = line.indexOf(MARKER);
  if (idx === -1) continue;
  try {
    const payload = JSON.parse(line.slice(idx + MARKER.length).trim());
    await saveEvent({ ...payload, source: "bds-bridge" });
    count += 1;
  } catch (err) {
    console.error(`[bridge] bad JSON: ${err.message}`);
  }
}

console.log(`[bridge] finished. events=${count}`);
