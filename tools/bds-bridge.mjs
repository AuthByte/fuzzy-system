#!/usr/bin/env node
/**
 * BDS → BlockLogger dashboard bridge
 *
 * Reads Bedrock Dedicated Server stdout / log lines, finds BlockLogger
 * payloads, and POSTs them to the dashboard API.
 *
 * Usage:
 *   node tools/bds-bridge.mjs
 *   tail -F path/to/bds/logs/latest.log | node tools/bds-bridge.mjs
 *   ./bedrock_server | tee server.log | node tools/bds-bridge.mjs
 *
 * Env:
 *   BLOCKLOGGER_URL   default http://127.0.0.1:8787/api/logs
 *   BLOCKLOGGER_API_KEY  optional shared secret
 */

import readline from "node:readline";

const ENDPOINT = process.env.BLOCKLOGGER_URL || "http://127.0.0.1:8787/api/logs";
const API_KEY = process.env.BLOCKLOGGER_API_KEY || "";
const MARKER = "BLJSON:";

const queue = [];
let flushing = false;
let accepted = 0;
let failed = 0;

async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, 50);
  try {
    const headers = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-BlockLogger-Key"] = API_KEY;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      failed += batch.length;
      const text = await res.text();
      console.error(`[bridge] POST failed ${res.status}: ${text}`);
      // re-queue once
      queue.unshift(...batch);
    } else {
      accepted += batch.length;
      if (accepted % 25 === 0) {
        console.log(`[bridge] posted ${accepted} events (failed=${failed}, queued=${queue.length})`);
      }
    }
  } catch (err) {
    failed += batch.length;
    queue.unshift(...batch);
    console.error(`[bridge] network error: ${err.message || err}`);
  } finally {
    flushing = false;
    if (queue.length) setTimeout(flush, 250);
  }
}

function handleLine(line) {
  const idx = line.indexOf(MARKER);
  if (idx === -1) return;
  const jsonText = line.slice(idx + MARKER.length).trim();
  try {
    const payload = JSON.parse(jsonText);
    payload.source = payload.source || "bds-bridge";
    queue.push(payload);
    if (queue.length >= 10) flush();
    else setTimeout(flush, 400);
  } catch (err) {
    console.error(`[bridge] bad JSON: ${err.message}`);
  }
}

console.log(`[bridge] watching stdin for ${MARKER} → ${ENDPOINT}`);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", handleLine);
rl.on("close", () => {
  flush().then(() => {
    console.log(`[bridge] done. accepted=${accepted} failed=${failed}`);
  });
});
