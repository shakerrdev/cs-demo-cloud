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

| Source | How | Notes |
| --- | --- | --- |
| Valve matchmaking | Steam Web API `GetNextMatchSharingCode` with your match-history auth code, then the Game Coordinator resolves each share code to a download URL | Needs a logged-in Steam account for the GC (a separate bot account is safest). Download links expire about a month after the match, so fetch promptly |
| Upload | Drag and drop a `.dem` / `.dem.bz2` | Works for anything: FACEIT, scrims, servers |
| FACEIT | Data API for match lists | Demo downloads are behind a restricted API; manual upload until access is granted |

## Proposed stack

- **TypeScript** end to end
- **Parser**: [`@laihoe/demoparser2`](https://github.com/LaihoE/demoparser) (Rust core with Node bindings)
- **Steam/GC**: `steam-user` + `globaloffensive`
- **Web**: SvelteKit (UI + API)
- **Worker**: separate process for fetching and parsing, so the web app never blocks
- **DB**: SQLite to start (Drizzle), Postgres later if needed
- **Storage**: local disk or any S3-compatible bucket behind one interface
- **Deploy**: Docker Compose on a small VPS

## Roadmap

- [ ] Project scaffold (web, worker, shared types)
- [ ] Upload + parse a demo into replay blobs and stats
- [ ] 2D radar viewer
- [ ] Match list and scoreboards
- [ ] Auto-fetch via share codes + Game Coordinator
- [ ] Auth with invite links
- [ ] 3D viewer
