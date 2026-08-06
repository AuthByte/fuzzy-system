#!/usr/bin/env node
/**
 * Pull BlockLogger events out of Minecraft's own log files into a JSON folder.
 *
 * Why: the add-on cannot create a normal file on your PC by itself.
 * It DOES print BLJSON:... lines into Minecraft's content/script logs.
 * This tool finds those lines and writes:
 *
 *   logs/blocklogger/events.jsonl
 *   logs/blocklogger/YYYY-MM-DD.json
 *   logs/blocklogger/latest.json
 *
 * Usage (from the repo root, on the same PC that runs Minecraft):
 *   node tools/pull-minecraft-logs.mjs
 *   node tools/pull-minecraft-logs.mjs --open
 *
 * Or double-click: tools/export-logs.cmd
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR =
  process.env.BLOCKLOGGER_LOG_DIR || path.join(ROOT, "logs", "blocklogger");
const MARKER = "BLJSON:";
const shouldOpen = process.argv.includes("--open");

function candidateLogDirs() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const dirs = [
    path.join(
      local,
      "Packages",
      "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
      "LocalState",
      "logs"
    ),
    path.join(
      local,
      "Packages",
      "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe",
      "LocalState",
      "logs"
    ),
    path.join(
      local,
      "Packages",
      "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
      "LocalState",
      "games",
      "com.mojang",
      "minecraftpe"
    ),
    path.join(home, ".var", "app", "io.mrarm.mcpelauncher-ui", "data", "logs"),
    path.join(home, "Library", "Application Support", "mcpelauncher", "logs"),
    path.join(ROOT, "logs"),
  ];

  // Also allow an explicit override
  if (process.env.MINECRAFT_LOG_DIR) {
    dirs.unshift(process.env.MINECRAFT_LOG_DIR);
  }
  return dirs;
}

function listFilesRecursive(dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listFilesRecursive(full, depth + 1));
    } else if (ent.isFile()) {
      const lower = ent.name.toLowerCase();
      if (
        lower.endsWith(".log") ||
        lower.endsWith(".txt") ||
        lower.includes("content") ||
        lower.includes("script")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

function extractFromText(text) {
  /** @type {object[]} */
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(MARKER);
    if (idx === -1) continue;
    try {
      items.push(JSON.parse(line.slice(idx + MARKER.length).trim()));
    } catch {
      // skip bad lines
    }
  }
  return items;
}

async function main() {
  const { saveEvent } = await import(
    pathToFileURL(path.join(__dirname, "local-json-logger.mjs")).href
  );

  const dirs = candidateLogDirs().filter((d) => fs.existsSync(d));
  console.log("[pull] scanning Minecraft log folders…");
  if (!dirs.length) {
    console.log("[pull] No Minecraft log folders found on this PC.");
    console.log("[pull] Make sure you play on THIS computer (not only a console/phone).");
    console.log("[pull] After placing/breaking blocks in-game, run this again.");
    process.exitCode = 1;
    return;
  }

  for (const d of dirs) console.log(`  - ${d}`);

  const files = dirs.flatMap((d) => listFilesRecursive(d));
  if (!files.length) {
    console.log("[pull] Folders exist but no .log/.txt files yet.");
    process.exitCode = 1;
    return;
  }

  /** @type {Map<string, object>} */
  const unique = new Map();
  for (const file of files) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const item of extractFromText(text)) {
      const key = [
        item.time || item.time_ms || item.t,
        item.player || item.p,
        item.action || item.a,
        item.block || item.b,
        item.location?.x ?? item.x,
        item.location?.y ?? item.y,
        item.location?.z ?? item.z,
      ].join("|");
      unique.set(key, item);
    }
  }

  if (!unique.size) {
    console.log("[pull] Found log files, but no BLJSON lines yet.");
    console.log("[pull] In Minecraft: place/break a few blocks, then run this again.");
    console.log("[pull] Tip: Settings → Creator → enable Content Log GUI / File if available.");
    process.exitCode = 1;
    return;
  }

  let saved = 0;
  for (const item of unique.values()) {
    await saveEvent({ ...item, source: item.source || "minecraft-log" });
    saved += 1;
  }

  const latest = path.join(OUT_DIR, "latest.json");
  console.log(`[pull] saved ${saved} event(s)`);
  console.log(`[pull] folder: ${OUT_DIR}`);
  console.log(`[pull] open:   ${latest}`);

  if (shouldOpen) {
    try {
      if (process.platform === "win32") execSync(`explorer "${OUT_DIR}"`);
      else if (process.platform === "darwin") execSync(`open "${OUT_DIR}"`);
      else execSync(`xdg-open "${OUT_DIR}"`);
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
