# Development

## Layout

```
juno/
  docker-compose.yml, Dockerfile, supervisord.conf, .env.example
  scripts/            entrypoint, model download/verify, healthcheck
  ace_proxy/          Node/Express + TypeScript proxy (port 3000)
    src/config.ts     ports, paths, PRESET TABLE
    src/aceClient.ts  all HTTP calls to ACE-Step (port 8001)
    src/tasks.ts      Juno form -> ACE-Step payload; status normalization
    src/routes.ts     /api/* endpoints
    src/storage.ts    JSON library DB (/data/juno-db.json)
  web/                React + Vite + TypeScript frontend (plain CSS)
    src/App.tsx       store (context) + hash router + task polling
    src/components/   Sidebar, BottomPlayer, CreatePanel, SongRow, ...
    src/pages/        Create, Library, Studio, Editor, Trash, Settings
    src/data/         model presets + mock data
    src/styles/       tokens.css (design tokens), global.css
  docs/               this folder
```

## Running locally without Docker

Terminal 1 — proxy (uses local dirs instead of /models etc.):

```bash
cd ace_proxy
npm install && npm run build
JUNO_DATA_DIR=../.dev/data JUNO_OUTPUT_DIR=../.dev/outputs \
JUNO_UPLOAD_DIR=../.dev/uploads npm start
```

Terminal 2 — frontend dev server with hot reload (proxies `/api` to 3000):

```bash
cd web
npm install && npm run dev   # http://localhost:5173
```

Without a real ACE-Step server the app still works: mock data populates
every screen and generation attempts create documented failed rows. To
develop against a real ACE-Step instance, run it on port 8001 (or set
`JUNO_ACE_API_URL`).

## Type checking / builds

```bash
cd web && npm run build        # tsc -b && vite build
cd ace_proxy && npm run build  # tsc
```

Both must pass with zero errors; the Docker build runs the same commands.

## Adding a hidden model preset

The UI must only ever show the three XL presets. For local
experimentation:

1. Add the preset to `ace_proxy/src/config.ts` (`presets` table) with its
   `ditPath`/slot/steps/CFG.
2. Add a matching entry to `HIDDEN_DEV_PRESETS` in
   `web/src/data/modelPresets.ts` — entries there are **never rendered**.
   Only move it into `MODEL_PRESETS` in a private fork if you truly want
   it selectable.
3. Mount the extra weights into `/models` and extend
   `scripts/download_models.py` if it should auto-download.

## Conventions

- Frontend never talks to port 8001 — all traffic goes through `/api/*`
  and the `/library-audio` / `/upload-audio` static routes.
- Optimistic UI: metadata mutations apply locally first and mirror to the
  proxy best-effort, so the app works with the backend down.
- Plain CSS only, driven by the tokens in `src/styles/tokens.css`.
- Local-only actions (Reverse, Crop, Speed, ...) must never silently call
  the model; ACE-backed actions must never silently no-op when ACE-Step is
  down (they create failed/placeholder rows instead).
