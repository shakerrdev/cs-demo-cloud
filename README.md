# cs-demo-cloud

A lightweight, self-hosted CS2 demo manager that lives in the browser: it fetches your matches automatically, stores them, shows stats, and lets you actually **watch** them without launching CS2.

Invite-only multi-user, but built for one person first.

## Goals

- **Auto-fetch** new matchmaking demos (Premier, Competitive, Wingman) without manual downloads
- **Store** demos and parsed data cheaply
- **Watch** demos in the browser: 2D radar first, 3D later
- **Stats** per match, round and player
- **Fast**: a match opens in about a second, scrubbing is instant
- **Light**: runs on one small server

## How replay works

Running a real CS2 client per viewer and streaming video needs a GPU server, a Steam account per stream and lots of bandwidth. Instead, demos are parsed once on the server into compact per-round replay files, and the browser animates them itself.

```
.dem ──► parser (once, server) ──► per-round replay blobs ──► browser renderer
                                 └► stats in the database
```

### Replay format

- One binary blob per round, compressed (brotli/zstd), served as static files
- Player state sampled at ~16 Hz: position (quantized int16), view angles, health, armor, active weapon, flags (alive, flashed, defusing, ...)
- Events at full tick precision: shots, kills, damage, grenade throws with trajectories, bomb plant/defuse
- The client interpolates between samples (lerp, shortest-path for angles)
- Target: a few hundred KB per round, so the first round loads instantly and the rest stream in the background

### Viewer phases

1. **2D radar**: top-down map overview, players, view cones, grenades, smokes/fires, kill feed, timeline with round markers, speed control. WebGL (PixiJS) so it stays smooth at high speed.
2. **3D**: map geometry exported from the game files with Source2Viewer-CLI to glTF, compressed with gltfpack (meshopt + KTX2), rendered with three.js. Free camera, plus player POV from eye position and view angles.

Map assets come from Valve's game files, which is fine for a private instance but not something to redistribute publicly.

## Demo sources

Upload is the primary way in and always works. Auto-fetch and import helpers build on top of it.

| Source              | How                                                                                                                                               | Notes                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload              | Drag and drop a `.dem` / `.dem.bz2` / `.dem.gz` / `.dem.zst`                                                                                      | Works for anything: matchmaking, FACEIT, scrims, servers                                                                                              |
| Valve matchmaking   | Steam Web API `GetNextMatchSharingCode` with your match-history auth code, then the Game Coordinator resolves each share code to a download URL   | Needs a logged-in Steam account for the GC (a separate bot account is safest). Download links expire about a month after the match, so fetch promptly |
| Companion extension | Browser extension / userscript that adds a "Send to cs-demo-cloud" button on sites like FACEIT and sends the demo with your own logged-in session | Works around platforms that lock demo downloads behind private APIs. Authenticates with a personal API token                                          |

## Stack

- **TypeScript** end to end, run directly by Node (no build step outside the web app)
- **Parser**: [`@laihoe/demoparser2`](https://github.com/LaihoE/demoparser) (Rust core with Node bindings)
- **Steam/GC**: `steam-user` + `globaloffensive`
- **Web**: SvelteKit 3 (UI + API), adapter-node
- **Worker**: separate process for fetching and parsing, so the web app never blocks
- **DB**: SQLite via Drizzle, which also serves as the job queue
- **Storage**: local disk or any S3-compatible bucket behind one interface
- **Deploy**: Docker Compose on a small VPS

## Layout

```
apps/web         SvelteKit app
apps/worker      fetch + parse jobs
packages/db      schema, migrations, queries
packages/shared  code used by everything
```

## Development

Requires Node 22.18+ and pnpm 10.

```sh
pnpm install
pnpm dev
```

`pnpm dev` applies migrations, then starts the web app on http://localhost:5173 and the worker. Data lives in `./data` unless `DATA_DIR` is set.

| Command            | What it does                             |
| ------------------ | ---------------------------------------- |
| `pnpm check`       | Type check every package                 |
| `pnpm lint`        | Check formatting                         |
| `pnpm format`      | Format everything                        |
| `pnpm build`       | Production build of the web app          |
| `pnpm db:generate` | Create a migration after a schema change |
| `pnpm db:migrate`  | Apply migrations                         |

## Roadmap

- [x] Project scaffold (web, worker, shared types)
- [ ] Upload + parse a demo into replay blobs and stats
- [ ] 2D radar viewer
- [ ] Match list and scoreboards
- [ ] Auto-fetch via share codes + Game Coordinator
- [ ] Auth with invite links
- [ ] Personal API tokens
- [ ] Companion extension (FACEIT and other sites)
- [ ] 3D viewer
