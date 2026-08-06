# BlockLogger — Minecraft Bedrock Block Logging Add-on

CoreProtect-style logging for **Minecraft Bedrock Edition**. Records every player block place and break with player name, block type, action, coordinates, dimension, and timestamp. Supports in-game lookup/rollback **and** an optional web dashboard for Bedrock Dedicated Server.

## No experiments required

This pack uses the **stable** `@minecraft/server` Script API only.

- **Do not** enable Beta APIs / Experiments
- Works on **existing worlds** — just activate the behavior pack
- The website path uses a **log bridge** (no `@minecraft/server-net`, no Beta APIs)

## What gets logged

```json
{
  "time": "2026-08-05T19:24:31.000Z",
  "player": "Finn",
  "action": "placed",
  "block": "minecraft:diamond_block",
  "location": { "x": 152, "y": 67, "z": -421 },
  "dimension": "minecraft:overworld"
}
```

## Install the behavior pack

1. Copy `packs/BlockLogger_BP` into the world’s `behavior_packs` folder  
   **or** import `BlockLogger_BP.mcpack` (`python3 tools/package.py`).
2. Edit world → **Behavior Packs** → activate **BlockLogger**.
3. Load the world. Chat will confirm logging is on.

### In-game commands

```
!bl help
!bl inspect
!bl lookup Finn
!bl near 16
!bl rollback Finn 1h
!bl stats
```

Slash forms also exist: `/blocklogger:inspect`, `/blocklogger:lookup`, etc.

## Web dashboard (BDS)

Rich UI with player / time / coordinate filters, activity chart, and XZ scatter map.

### 1. Start the dashboard

```bash
cd dashboard
npm install
npm start
# → http://127.0.0.1:8787
```

Optional:

```bash
export BLOCKLOGGER_API_KEY='your-secret'
npm run seed      # sample events
npm run test:api  # smoke test
```

### 2. Enable bridge output in the pack

In `packs/BlockLogger_BP/scripts/config.js`:

```js
bridgeConsole: true,  // already default on
```

Each event prints a line like `BLJSON:{...}` to the BDS console/content log.

### 3. Pipe BDS logs into the bridge

```bash
# terminal A
cd dashboard && npm start

# terminal B — pipe server output (example)
./bedrock_server 2>&1 | node tools/bds-bridge.mjs

# or tail an existing log file
tail -F logs/latest.log | node tools/bds-bridge.mjs
```

Bridge env vars:

| Variable | Default |
|---|---|
| `BLOCKLOGGER_URL` | `http://127.0.0.1:8787/api/logs` |
| `BLOCKLOGGER_API_KEY` | _(empty)_ |

Open **http://127.0.0.1:8787** and filter by player, time range, block name, or XYZ + radius.

### API

- `GET /api/health`
- `GET /api/stats`
- `GET /api/players`
- `GET /api/logs?player=&action=&dimension=&block=&from=&to=&x=&y=&z=&radius=&limit=&offset=`
- `POST /api/logs` — single object or array (header `X-BlockLogger-Key` if keyed)
- `POST /block-log` — same as POST `/api/logs`

## Where logs live

| Path | Storage |
|---|---|
| In-game (always) | World dynamic properties (soft cap ~8000) |
| Dashboard | SQLite file at `dashboard/data/blocklogger.sqlite` |

## Configuration (`scripts/config.js`)

- `chatPrefix` — default `!bl`
- `bridgeConsole` — emit `BLJSON:` for the BDS bridge
- `httpEndpoint` / `httpApiKey` — optional direct POST if your runtime has `fetch`
- `maxEntries`, `lookupLimit`, `maxRollbackBlocks`

## Limitations

Not fully attributed with the standard API alone: explosions without a player source, fluid flow, pistons, natural generation/decay.

## Project layout

```
packs/BlockLogger_BP/   # Bedrock behavior pack
dashboard/              # Web API + visual UI
tools/bds-bridge.mjs    # BDS log → HTTP bridge
tools/package.py        # builds .mcpack
```

## License

MIT
