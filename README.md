# BlockLogger — Minecraft Bedrock Block Logging Add-on

CoreProtect-style logging for **Minecraft Bedrock Edition**. Records every player block place and break with player name, block type, action, coordinates, dimension, and timestamp. Supports lookup, inspect, rollback, and restore.

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

- Minecraft Bedrock **1.21.100+** (Script API `@minecraft/server` 2.1.0+)
- **Beta APIs** enabled in world settings (Experiments → Beta APIs)
- Cheats / operator permission for rollback commands

## Install

### Option A — Folder (dev / Realms upload)

1. Copy `packs/BlockLogger_BP` into your world's `behavior_packs` folder  
   **or** into `development_behavior_packs` for local testing.
2. Create/open a world → **Behavior Packs** → activate **BlockLogger**.
3. Enable **Beta APIs** under Experiments.
4. Load the world.

### Option B — `.mcpack`

```bash
python3 tools/package.py
```

Then double-click `dist/BlockLogger_BP.mcpack` (or import it in Minecraft).

## Commands

All commands are also available without the namespace in chat (e.g. `/inspect`), but prefer the namespaced form in command blocks and functions.

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

### Examples

```
/blocklogger:inspect
/blocklogger:lookup Finn
/blocklogger:near 16
/blocklogger:rollback Finn 1h
/blocklogger:rollbackhere 30m 12
/blocklogger:restore 3
```

### Script-event fallback

If custom commands are unavailable:

```
/scriptevent blocklogger:lookup Finn
/scriptevent blocklogger:rollback Finn 1h
/scriptevent blocklogger:help
```

## How it works

1. Subscribes to `world.afterEvents.playerPlaceBlock` and `playerBreakBlock`.
2. Appends a compact log entry to **world dynamic properties** (survives restarts).
3. Chunks storage across multiple properties to stay under the per-property string limit.
4. Prunes oldest entries when the soft cap (`maxEntries`, default 8000) is exceeded.
5. Rollback walks matching entries newest-first and applies the inverse (placed → air, broken → restored block + states).

## Configuration

Edit `packs/BlockLogger_BP/scripts/config.js`:

- `maxEntries` — soft cap before pruning
- `lookupLimit` — chat result page size
- `maxRollbackBlocks` — safety limit per rollback
- `httpEndpoint` — optional URL for external logging (BDS / custom runtime with `fetch`)
- `debugConsole` — echo every log to content log

## Limitations

Player place/break logging is solid. These are **not** fully attributed with the standard API alone:

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
    commands.js    # slash + scriptevent UI
    rollback.js    # rollback / restore jobs
    format.js      # entry formatting
    time.js        # duration parsing
tools/package.py   # builds .mcpack
```

## License

MIT
