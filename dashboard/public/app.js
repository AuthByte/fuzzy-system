const state = {
  offset: 0,
  limit: 100,
  total: 0,
  items: [],
};

const els = {
  form: document.getElementById("filterForm"),
  logBody: document.getElementById("logBody"),
  resultMeta: document.getElementById("resultMeta"),
  playerList: document.getElementById("playerList"),
  livePulse: document.getElementById("livePulse"),
  liveLabel: document.getElementById("liveLabel"),
  statTotal: document.getElementById("statTotal"),
  statPlaced: document.getElementById("statPlaced"),
  statBroken: document.getElementById("statBroken"),
  statPlayers: document.getElementById("statPlayers"),
  activityBars: document.getElementById("activityBars"),
  topPlayers: document.getElementById("topPlayers"),
  scatter: document.getElementById("scatter"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  resetBtn: document.getElementById("resetBtn"),
};

function toMs(localValue) {
  if (!localValue) return undefined;
  const ms = Date.parse(localValue);
  return Number.isFinite(ms) ? ms : undefined;
}

function shortDim(id) {
  if (!id) return "?";
  if (id.endsWith("overworld")) return "OW";
  if (id.endsWith("nether")) return "Nether";
  if (id.endsWith("the_end")) return "End";
  return id.replace("minecraft:", "");
}

function shortBlock(id) {
  return String(id || "").replace(/^minecraft:/, "");
}

function formatTime(iso) {
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

function currentFilters() {
  const fd = new FormData(els.form);
  const params = new URLSearchParams();
  for (const [key, value] of fd.entries()) {
    if (key === "fromLocal" || key === "toLocal") continue;
    if (value !== "" && value !== null) params.set(key, value);
  }
  const from = toMs(fd.get("fromLocal"));
  const to = toMs(fd.get("toLocal"));
  if (from !== undefined) params.set("from", String(from));
  if (to !== undefined) params.set("to", String(to));

  // Only apply radius if a center point is provided
  if (!params.has("x") || !params.has("y") || !params.has("z")) {
    params.delete("radius");
  }

  params.set("limit", String(state.limit));
  params.set("offset", String(state.offset));
  return params;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function renderTable(items) {
  if (!items.length) {
    els.logBody.innerHTML = `<tr><td colspan="6" class="empty">No events match these filters.</td></tr>`;
    return;
  }

  els.logBody.innerHTML = items
    .map((item) => {
      const { x, y, z } = item.location;
      return `<tr>
        <td class="mono">${formatTime(item.time)}</td>
        <td>${escapeHtml(item.player)}</td>
        <td><span class="action-pill ${item.action}">${item.action}</span></td>
        <td class="mono">${escapeHtml(shortBlock(item.block))}</td>
        <td class="mono">${x} ${y} ${z}</td>
        <td>${shortDim(item.dimension)}</td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function drawScatter(items) {
  const canvas = els.scatter;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 280;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  ctx.fillStyle = "rgba(125, 211, 168, 0.08)";
  for (let i = 0; i < cssW; i += 40) {
    ctx.fillRect(i, 0, 1, cssH);
  }
  for (let j = 0; j < cssH; j += 40) {
    ctx.fillRect(0, j, cssW, 1);
  }

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
    ctx.fillStyle = item.action === "placed" ? "#5eead4" : "#fb923c";
    ctx.globalAlpha = 0.85;
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function renderStats(stats) {
  els.statTotal.textContent = String(stats.total ?? 0);
  els.statPlaced.textContent = String(stats.placed ?? 0);
  els.statBroken.textContent = String(stats.broken ?? 0);
  els.statPlayers.textContent = String(stats.players ?? 0);

  const counts = (stats.activityByHour || []).map((h) => h.count);
  const max = Math.max(1, ...counts);
  els.activityBars.innerHTML = (stats.activityByHour || [])
    .map((h, idx) => {
      const height = Math.max(8, Math.round((h.count / max) * 64));
      return `<span style="height:${height}px;animation-delay:${idx * 0.02}s" title="${h.count}"></span>`;
    })
    .join("");

  els.topPlayers.innerHTML = (stats.topPlayers24h || [])
    .map(
      (p) =>
        `<li><span>${escapeHtml(p.player)}</span><span>${p.c}</span></li>`
    )
    .join("") || `<li><span>No activity yet</span><span>0</span></li>`;
}

async function loadPlayers() {
  const data = await fetchJson("/api/players");
  els.playerList.innerHTML = (data.players || [])
    .map((p) => `<option value="${escapeHtml(p.player)}"></option>`)
    .join("");
}

async function loadLogs() {
  const params = currentFilters();
  const data = await fetchJson(`/api/logs?${params}`);
  state.total = data.total;
  state.items = data.items;
  els.resultMeta.textContent = `${data.total} match${data.total === 1 ? "" : "es"} · showing ${data.items.length} · offset ${data.offset}`;
  renderTable(data.items);
  drawScatter(data.items);
  els.prevPage.disabled = state.offset <= 0;
  els.nextPage.disabled = state.offset + state.limit >= state.total;
}

async function refreshAll() {
  try {
    const health = await fetchJson("/api/health");
    els.livePulse.classList.add("ok");
    els.liveLabel.textContent = `live · ${new Date(health.time).toLocaleTimeString()}`;
  } catch {
    els.livePulse.classList.remove("ok");
    els.liveLabel.textContent = "offline";
  }

  const stats = await fetchJson("/api/stats");
  renderStats(stats);
  await loadPlayers();
  await loadLogs();
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  state.offset = 0;
  loadLogs().catch(console.error);
});

els.resetBtn.addEventListener("click", () => {
  els.form.reset();
  document.getElementById("radius").value = "8";
  state.offset = 0;
  loadLogs().catch(console.error);
});

document.querySelectorAll(".quick-times button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const hours = Number(btn.dataset.hours);
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);
    const toLocal = toISOLocal(to);
    const fromLocal = toISOLocal(from);
    document.getElementById("fromLocal").value = fromLocal;
    document.getElementById("toLocal").value = toLocal;
    state.offset = 0;
    loadLogs().catch(console.error);
  });
});

els.prevPage.addEventListener("click", () => {
  state.offset = Math.max(0, state.offset - state.limit);
  loadLogs().catch(console.error);
});

els.nextPage.addEventListener("click", () => {
  state.offset += state.limit;
  loadLogs().catch(console.error);
});

window.addEventListener("resize", () => drawScatter(state.items));

function toISOLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

refreshAll().catch(console.error);
setInterval(() => {
  refreshAll().catch(console.error);
}, 15_000);
