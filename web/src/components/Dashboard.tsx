"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { LogEvent, Stats } from "@/lib/types";

type PlayersResponse = {
  players: { player: string; count: number; lastSeen: string }[];
};

const emptyStats: Stats = {
  total: 0,
  placed: 0,
  broken: 0,
  ignited: 0,
  exploded: 0,
  opened: 0,
  killed: 0,
  players: 0,
  topPlayers24h: [],
  activityByHour: [],
};

function toMs(localValue: string) {
  if (!localValue) return undefined;
  const ms = Date.parse(localValue);
  return Number.isFinite(ms) ? ms : undefined;
}

function toISOLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shortDim(id: string) {
  if (!id) return "?";
  if (id.endsWith("overworld")) return "OW";
  if (id.endsWith("nether")) return "Nether";
  if (id.endsWith("the_end")) return "End";
  return id.replace("minecraft:", "");
}

function shortBlock(id: string) {
  return String(id || "").replace(/^minecraft:/, "");
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function parseImportText(raw: string): Record<string, unknown>[] {
  const text = raw.trim();
  if (!text) return [];

  // Full JSON array or object
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.logs)) return parsed.logs;
    return [parsed];
  }

  // BLJSON lines or plain JSON lines
  const items: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("BLJSON:");
    const jsonText = idx >= 0 ? trimmed.slice(idx + 7).trim() : trimmed;
    items.push(JSON.parse(jsonText));
  }
  return items;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats & { storage?: string }>(emptyStats);
  const [items, setItems] = useState<LogEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(100);
  const [players, setPlayers] = useState<string[]>([]);
  const [live, setLive] = useState("connecting");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const [filters, setFilters] = useState({
    player: "",
    action: "",
    dimension: "",
    block: "",
    fromLocal: "",
    toLocal: "",
    x: "",
    y: "",
    z: "",
    radius: "8",
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.player) params.set("player", filters.player);
    if (filters.action) params.set("action", filters.action);
    if (filters.dimension) params.set("dimension", filters.dimension);
    if (filters.block) params.set("block", filters.block);
    const from = toMs(filters.fromLocal);
    const to = toMs(filters.toLocal);
    if (from !== undefined) params.set("from", String(from));
    if (to !== undefined) params.set("to", String(to));
    if (filters.x && filters.y && filters.z) {
      params.set("x", filters.x);
      params.set("y", filters.y);
      params.set("z", filters.z);
      params.set("radius", filters.radius || "0");
    }
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    return params.toString();
  }, [filters, limit, offset]);

  const refresh = useCallback(async () => {
    try {
      const health = await fetch("/api/health").then((r) => r.json());
      setLive(
        health.ok
          ? `live · ${new Date(health.time).toLocaleTimeString()} · ${health.storage}`
          : "offline"
      );
    } catch {
      setLive("offline");
    }

    const [statsJson, playersJson, logsJson] = await Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/players").then((r) => r.json()) as Promise<PlayersResponse>,
      fetch(`/api/logs?${queryString}`).then((r) => r.json()),
    ]);

    setStats(statsJson);
    setPlayers((playersJson.players || []).map((p) => p.player));
    setItems(logsJson.items || []);
    setTotal(logsJson.total || 0);
  }, [queryString]);

  useEffect(() => {
    refresh().catch(console.error);
    const id = setInterval(() => refresh().catch(console.error), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const canvas = document.getElementById("scatter") as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 900;
    const cssH = 280;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "rgba(125, 211, 168, 0.08)";
    for (let i = 0; i < cssW; i += 40) ctx.fillRect(i, 0, 1, cssH);
    for (let j = 0; j < cssH; j += 40) ctx.fillRect(0, j, cssW, 1);
    if (!items.length) {
      ctx.fillStyle = "#8aa899";
      ctx.font = "14px IBM Plex Mono, monospace";
      ctx.fillText("No points in view", 24, cssH / 2);
      return;
    }
    const xs = items.map((i) => i.location.x);
    const zs = items.map((i) => i.location.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const pad = 24;
    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    for (const item of items) {
      const px = pad + ((item.location.x - minX) / spanX) * (cssW - pad * 2);
      const py = pad + ((item.location.z - minZ) / spanZ) * (cssH - pad * 2);
      ctx.beginPath();
      ctx.fillStyle =
        item.action === "placed"
          ? "#5eead4"
          : item.action === "ignited"
            ? "#f87171"
            : item.action === "exploded"
              ? "#c084fc"
              : item.action === "opened"
                ? "#38bdf8"
                : item.action === "killed"
                  ? "#f472b6"
                  : "#fb923c";
      ctx.globalAlpha = 0.85;
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [items]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    refresh().catch(console.error);
  }

  async function onImport() {
    setImportMsg("");
    setBusy(true);
    try {
      const payload = parseImportText(importText);
      if (!payload.length) throw new Error("No events found in paste.");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) headers["X-BlockLogger-Key"] = apiKey;
      const res = await fetch("/api/logs", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      setImportMsg(`Imported ${json.inserted} event(s).`);
      setImportText("");
      await refresh();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const maxHour = Math.max(1, ...stats.activityByHour.map((h) => h.count));

  return (
    <div className="shell">
      <div className="atmosphere" aria-hidden />

      <header className="top">
        <div>
          <p className="eyebrow">Bedrock survey console</p>
          <h1 className="brand">BlockLogger</h1>
          <p className="tagline">
            Hosted place &amp; break history — filter by player, time, and coordinates.
          </p>
        </div>
        <div className="top-meta">
          <span className={`pulse ${live.startsWith("live") ? "ok" : ""}`} />
          <span>{live}</span>
        </div>
      </header>

      <section className="notice">
        <strong>Worlds / Realms:</strong> Minecraft cannot auto-upload from a normal world.
        Use in-game <code>!bl dump</code>, then paste below. BDS can pipe logs with{" "}
        <code>tools/bds-bridge.mjs</code>.
      </section>

      <section className="stats">
        <article className="stat">
          <span className="stat-label">Events</span>
          <strong className="stat-value">{stats.total}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Placed</span>
          <strong className="stat-value placed">{stats.placed}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Broken</span>
          <strong className="stat-value broken">{stats.broken}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Ignited</span>
          <strong className="stat-value ignited">{stats.ignited ?? 0}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Exploded</span>
          <strong className="stat-value exploded">{stats.exploded ?? 0}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Opened</span>
          <strong className="stat-value opened">{stats.opened ?? 0}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Killed</span>
          <strong className="stat-value killed">{stats.killed ?? 0}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Players</span>
          <strong className="stat-value">{stats.players}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="filters">
          <form onSubmit={onSubmit} className="filter-form">
            <label>
              Player
              <input
                list="playerList"
                value={filters.player}
                onChange={(e) => setFilters((f) => ({ ...f, player: e.target.value }))}
                placeholder="Finn"
              />
            </label>
            <datalist id="playerList">
              {players.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>

            <label>
              Action
              <select
                value={filters.action}
                onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
              >
                <option value="">Any</option>
                <option value="placed">Placed</option>
                <option value="broken">Broken</option>
                <option value="ignited">Ignited</option>
                <option value="exploded">Exploded</option>
                <option value="opened">Opened</option>
                <option value="killed">Killed</option>
              </select>
            </label>

            <label>
              Dimension
              <select
                value={filters.dimension}
                onChange={(e) => setFilters((f) => ({ ...f, dimension: e.target.value }))}
              >
                <option value="">Any</option>
                <option value="minecraft:overworld">Overworld</option>
                <option value="minecraft:nether">Nether</option>
                <option value="minecraft:the_end">The End</option>
              </select>
            </label>

            <label>
              Block contains
              <input
                value={filters.block}
                onChange={(e) => setFilters((f) => ({ ...f, block: e.target.value }))}
                placeholder="diamond"
              />
            </label>

            <fieldset>
              <legend>Time range</legend>
              <label>
                From
                <input
                  type="datetime-local"
                  value={filters.fromLocal}
                  onChange={(e) => setFilters((f) => ({ ...f, fromLocal: e.target.value }))}
                />
              </label>
              <label>
                To
                <input
                  type="datetime-local"
                  value={filters.toLocal}
                  onChange={(e) => setFilters((f) => ({ ...f, toLocal: e.target.value }))}
                />
              </label>
              <div className="quick-times">
                {[1, 6, 24, 168].map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => {
                      const to = new Date();
                      const from = new Date(to.getTime() - hours * 3600_000);
                      setFilters((f) => ({
                        ...f,
                        fromLocal: toISOLocal(from),
                        toLocal: toISOLocal(to),
                      }));
                      setOffset(0);
                    }}
                  >
                    {hours === 168 ? "7d" : `${hours}h`}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Coordinates</legend>
              <div className="coord-grid">
                {(["x", "y", "z"] as const).map((axis) => (
                  <label key={axis}>
                    {axis.toUpperCase()}
                    <input
                      type="number"
                      value={filters[axis]}
                      onChange={(e) => setFilters((f) => ({ ...f, [axis]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <label>
                Radius
                <input
                  type="number"
                  min={0}
                  value={filters.radius}
                  onChange={(e) => setFilters((f) => ({ ...f, radius: e.target.value }))}
                />
              </label>
            </fieldset>

            <div className="filter-actions">
              <button type="submit" className="primary">
                Apply filters
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setFilters({
                    player: "",
                    action: "",
                    dimension: "",
                    block: "",
                    fromLocal: "",
                    toLocal: "",
                    x: "",
                    y: "",
                    z: "",
                    radius: "8",
                  });
                  setOffset(0);
                }}
              >
                Reset
              </button>
            </div>
          </form>

          <div className="import-box">
            <h2>Import from game</h2>
            <p>
              Run <code>!bl dump</code> in Minecraft, copy the JSON, paste here.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='[{"player":"Finn","action":"placed",...}] or BLJSON lines'
              rows={5}
            />
            <label>
              API key (if you set BLOCKLOGGER_API_KEY)
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="optional"
              />
            </label>
            <button type="button" className="primary" disabled={busy} onClick={onImport}>
              {busy ? "Importing…" : "Import logs"}
            </button>
            {importMsg ? <p className="import-msg">{importMsg}</p> : null}
          </div>

          <div className="activity">
            <h2>Last 24h</h2>
            <div className="bars">
              {stats.activityByHour.map((h, idx) => (
                <span
                  key={h.hour}
                  style={{
                    height: `${Math.max(8, Math.round((h.count / maxHour) * 64))}px`,
                    animationDelay: `${idx * 0.02}s`,
                  }}
                  title={`${h.count}`}
                />
              ))}
            </div>
            <h3>Top players</h3>
            <ul className="top-players">
              {(stats.topPlayers24h.length
                ? stats.topPlayers24h
                : [{ player: "No activity yet", c: 0 }]
              ).map((p) => (
                <li key={p.player}>
                  <span>{p.player}</span>
                  <span>{p.c}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="results">
          <div className="results-head">
            <h2>Event stream</h2>
            <p>
              {total} match{total === 1 ? "" : "es"} · showing {items.length} · offset {offset}
            </p>
          </div>

          <div className="map-panel">
            <canvas id="scatter" />
            <p className="map-caption">XZ scatter of the current result set</p>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Player</th>
                  <th>Action</th>
                  <th>Block</th>
                  <th>Coords</th>
                  <th>Dim</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      No events yet. Import with !bl dump or connect BDS bridge.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={String(item.id)}>
                      <td className="mono">{formatTime(item.time)}</td>
                      <td>{item.player}</td>
                      <td>
                        <span className={`action-pill ${item.action}`}>{item.action}</span>
                      </td>
                      <td className="mono">{shortBlock(item.block)}</td>
                      <td className="mono">
                        {item.location.x} {item.location.y} {item.location.z}
                      </td>
                      <td>{shortDim(item.dimension)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <button
              type="button"
              className="ghost"
              disabled={offset <= 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              Newer
            </button>
            <button
              type="button"
              className="ghost"
              disabled={offset + limit >= total}
              onClick={() => setOffset((o) => o + limit)}
            >
              Older
            </button>
          </div>
        </main>
      </section>
    </div>
  );
}
