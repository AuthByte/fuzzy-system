# BlockLogger — Minecraft Bedrock Block Logging Add-on

CoreProtect-style logging for **Minecraft Bedrock Edition**, with an optional **hosted website** (Vercel) for rich filters and visuals.

## Honest answer about “just the addon”

| What you want | Possible? |
|---|---|
| Host the website on Vercel (no PC server for viewing) | **Yes** |
| Add the pack to a normal world / Realms and have it auto-upload | **No** — Bedrock Script API cannot call the internet there |
| Sync to the website from a normal world | **Yes** — run `!bl dump` in game, paste into the site Import box |
| Auto-upload continuously | Needs **Bedrock Dedicated Server** + log bridge (or networking APIs) |

So: the **website runs on Vercel**. The **addon still logs in your world**. You push events to the site with dump/paste (easy) or a BDS bridge (automatic).

## No experiments required

Stable `@minecraft/server` only. Do **not** enable Beta APIs. Works on existing worlds.

## Install the behavior pack

1. Use `packs/BlockLogger_BP` (or `python3 tools/package.py` → `.mcpack`)
2. Activate it on your world
3. In chat: `!bl help`

### Useful commands

```
!bl inspect
!bl lookup Finn
!bl near 16
!bl dump 25          # copy JSON → paste on the website
!bl rollback Finn 1h
```

## Host the website on Vercel

The app lives in `web/` (Next.js).

1. Import this GitHub repo in [Vercel](https://vercel.com/new)
2. Set **Root Directory** to `web`
3. Add storage (Vercel dashboard → Storage):
   - **Neon** Postgres (sets `DATABASE_URL`) — preferred, or
   - **Blob** (sets `BLOB_READ_WRITE_TOKEN`)
4. Optional env: `BLOCKLOGGER_API_KEY` (protects imports/POSTs)
5. Deploy → open `https://your-project.vercel.app`

Local preview:

```bash
cd web
npm install
npm run dev
```

### Syncing logs to the hosted site

**Normal world / Realms**

1. Play with the pack on
2. `!bl dump`
3. Open your Vercel URL → **Import from game** → paste → Import

**Bedrock Dedicated Server (auto)**

```bash
# point bridge at your Vercel deployment
export BLOCKLOGGER_URL='https://your-project.vercel.app/api/logs'
export BLOCKLOGGER_API_KEY='optional-secret'
./bedrock_server 2>&1 | node tools/bds-bridge.mjs
```

Pack setting `bridgeConsole: true` (default) emits `BLJSON:` lines for the bridge.

## Where logs live

| Place | Storage |
|---|---|
| In Minecraft | World dynamic properties (always) |
| Website | Neon Postgres or Vercel Blob |

## Project layout

```
packs/BlockLogger_BP/   # Bedrock behavior pack
web/                    # Next.js site for Vercel
dashboard/              # Older local Express+SQLite demo (optional)
tools/bds-bridge.mjs    # BDS → website bridge
tools/package.py
```

## License

MIT
