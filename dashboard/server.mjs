import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getStats,
  insertLog,
  insertLogs,
  listPlayers,
  queryLogs,
} from "./db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.BLOCKLOGGER_API_KEY || "";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireKey(req, res, next) {
  if (!API_KEY) return next();
  const provided =
    req.header("x-blocklogger-key") ||
    req.header("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.query.key;
  if (provided !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "blocklogger-dashboard", time: new Date().toISOString() });
});

app.get("/api/stats", (_req, res) => {
  res.json(getStats());
});

app.get("/api/players", (_req, res) => {
  res.json({ players: listPlayers() });
});

app.get("/api/logs", (req, res) => {
  try {
    const result = queryLogs({
      player: req.query.player,
      action: req.query.action,
      dimension: req.query.dimension,
      block: req.query.block,
      from: req.query.from,
      to: req.query.to,
      x: req.query.x,
      y: req.query.y,
      z: req.query.z,
      radius: req.query.radius,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/logs", requireKey, (req, res) => {
  try {
    const body = req.body;
    if (Array.isArray(body)) {
      const inserted = insertLogs(body);
      return res.status(201).json({ inserted: inserted.length, items: inserted });
    }
    if (body?.logs && Array.isArray(body.logs)) {
      const inserted = insertLogs(body.logs);
      return res.status(201).json({ inserted: inserted.length, items: inserted });
    }
    const item = insertLog(body);
    return res.status(201).json({ inserted: 1, item });
  } catch (err) {
    return res.status(400).json({ error: String(err.message || err) });
  }
});

// Friendly alias matching pack config example: http://127.0.0.1:8787/block-log
app.post("/block-log", requireKey, (req, res) => {
  try {
    const body = req.body;
    if (Array.isArray(body)) {
      const inserted = insertLogs(body);
      return res.status(201).json({ inserted: inserted.length, items: inserted });
    }
    const item = insertLog(body);
    return res.status(201).json({ inserted: 1, item });
  } catch (err) {
    return res.status(400).json({ error: String(err.message || err) });
  }
});

app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[BlockLogger] Dashboard listening on http://127.0.0.1:${PORT}`);
  if (API_KEY) console.log("[BlockLogger] API key auth enabled for POST /api/logs");
  else console.log("[BlockLogger] WARNING: BLOCKLOGGER_API_KEY not set — POSTs are open");
});
