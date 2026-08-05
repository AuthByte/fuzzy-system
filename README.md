# BlockLogger — Minecraft Bedrock Block Logging Add-on

CoreProtect-style logging for **Minecraft Bedrock Edition**. Records every player block place and break with player name, block type, action, coordinates, dimension, and timestamp. Supports lookup, inspect, rollback, and restore.

## No experiments required

This pack uses the **stable** `@minecraft/server` Script API only.

- **Do not** enable Beta APIs / Experiments
- Works on **existing worlds** — just activate the behavior pack
- You generally **cannot** turn Beta APIs on after a world is created anyway; with this pack you don’t need to

(If an old guide told you to flip Beta APIs: ignore that. That was for beta/unstable script modules.)

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

Break events also store block states so rollbacks can restore stairs, slabs, logs, etc. correctly.

## Requirements

- Minecraft Bedrock **1.21.100+**
- Stable Script API (`@minecraft/server` 2.1.0+ in the manifest — **not** a `-beta` version)
- Operator permission for rollback/restore
- **No** Experiments / Beta APIs toggle

## Install (existing world is fine)

1. Copy `packs/BlockLogger_BP` into the world’s `behavior_packs` folder  
   **or** import `BlockLogger_BP.mcpack` (`python3 tools/package.py` to build it).
2. Edit world → **Behavior Packs** → activate **BlockLogger**.
3. Load the world. You should see a chat message that logging is on.

That’s it. No experiment screens.

## Commands

Easiest: chat prefix (no slash needed):

```
!bl help
!bl inspect
!bl lookup Finn
!bl near 16
!bl rollback Finn 1h
!bl rollbackhere 30m 12
!bl restore 3
!bl stats
```

Slash commands (also registered when available):

| Command | Description |
|---|---|
| `/blocklogger:help` | Show help |
| `/blocklogger:inspect` | History of the block you are looking at |
| `/blocklogger:lookup <player> [limit]` | Recent actions by a player |
| `/blocklogger:near [radius]` | Recent actions near you (default radius 8) |
| `/blocklogger:coords <x> <y> <z>` | History at coordinates |
| `/blocklogger:rollback <player> <time>` | Undo that player's changes in the time window |
| `/blocklogger:rollbackhere <time> [radius]` | Rollback changes near you |
| `/blocklogger:restore <id>` | Undo a rollback batch |
| `/blocklogger:stats` | Storage usage |
| `/blocklogger:export <player>` | Dump latest entry as JSON |

**Time formats:** `30s`, `5m`, `2h`, `1d`, `1w` (bare numbers = minutes).

### Script-event fallback

```
/scriptevent blocklogger:lookup Finn
/scriptevent blocklogger:rollback Finn 1h
/scriptevent blocklogger:help
```

## Where logs are stored

Inside the **world** as Script API dynamic properties (not a normal text file). Survives restarts. Soft-capped (default 8000 entries).

Outbound HTTP to a website is optional and mainly for Bedrock Dedicated Server setups — see `httpEndpoint` in `config.js`.

## How it works

1. Subscribes to stable `playerPlaceBlock` / `playerBreakBlock` after-events.
2. Appends compact entries to world dynamic properties.
3. Chunks storage under the per-property string limit; prunes oldest when over cap.
4. Rollback applies inverses (placed → air, broken → restored block + states).

## Configuration

Edit `packs/BlockLogger_BP/scripts/config.js`:

- `chatPrefix` — default `!bl`
- `maxEntries` — soft cap before pruning
- `lookupLimit` — chat result page size
- `maxRollbackBlocks` — safety limit per rollback
- `httpEndpoint` — optional URL for external logging
- `debugConsole` — echo every log to content log

## Limitations

Not fully attributed with the standard API alone:

- Explosions without a clear player source
- Fluid flow
- Piston pushes
- Natural generation / decay

## Project layout

```
packs/BlockLogger_BP/
  manifest.json
  scripts/
    main.js        # entry
    config.js      # tunables
    logger.js      # place/break listeners
    storage.js     # dynamic-property store
    commands.js    # slash + chat + scriptevent UI
    rollback.js    # rollback / restore jobs
    format.js      # entry formatting
    time.js        # duration parsing
tools/package.py   # builds .mcpack
```

## License

MIT
