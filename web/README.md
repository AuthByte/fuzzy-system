# BlockLogger website (Vercel)

## Deploy

1. Push this repo to GitHub
2. Import the `web` folder as a Vercel project (Root Directory = `web`)
3. Add storage:
   - **Neon** → sets `DATABASE_URL` (preferred), or
   - **Blob** → sets `BLOB_READ_WRITE_TOKEN`
4. Optional: `BLOCKLOGGER_API_KEY` to protect POST/import
5. Deploy

```bash
cd web
npx vercel link
npx vercel env pull .env.local
npx vercel --prod
```

## Local

```bash
cd web
npm install
# optional: DATABASE_URL=... or BLOB_READ_WRITE_TOKEN=...
npm run dev
```

## Syncing from Minecraft

Normal worlds/Realms **cannot** POST to the internet by themselves.

1. In game: `!bl dump`
2. On the website: paste into **Import from game**

Bedrock Dedicated Server can use `tools/bds-bridge.mjs` pointed at:

`https://YOUR_DEPLOYMENT.vercel.app/api/logs`
