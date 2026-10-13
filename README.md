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

- One gzipped binary file per round (`packages/replay`): a JSON header with the round's events, then one column per player field
- Player state sampled every 4 ticks (16 Hz at 64 tick): position as int16, view angles, health, armor, money, active weapon and flags (alive, helmet, kit, defusing, scoped, ducking, bomb), delta-encoded per player so gzip shrinks it well
- Events at full tick precision: kills, shots, blinds, bomb pickups/drops/plants/defuses, grenade flight paths and smoke/fire/flash/HE effects
- The browser interpolates between samples (lerp, shortest-path for angles)
- In practice about 30 KB per round and under 1 MB per match; a round loads in ~10 ms and the next one is prefetched

### Viewer phases

1. **2D radar** (done): players with view cones, health, bomb and kit, grenades in flight, smokes, fires, flashes, shots, kill markers, kill feed, round clock, timeline with kill/plant markers, speed control, upper/lower level for Nuke, Vertigo and co. Plain Canvas 2D: ten players and some grenades don't need a WebGL engine.
2. **3D**: map geometry exported from the game files with Source2Viewer-CLI to glTF, compressed with gltfpack (meshopt + KTX2), rendered with three.js. Free camera, plus player POV from eye position and view angles.

Map assets come from Valve's game files, which is fine for a private instance but not something to redistribute publicly, so none are committed here. The worker downloads a map's radar image (and lower-level image) the first time it parses a demo on that map, from [CS Demo Manager](https://github.com/akiver/cs-demo-manager)'s repository at a pinned commit, into `data/maps`. Map calibration (origin, scale, lower-level height) lives in `packages/replay/src/maps.ts`.

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
- **Storage**: local disk (`data/`): demos as uploaded, replays per round, radar images; S3-compatible storage later if needed
- **Deploy**: Docker Compose on a small VPS

## Layout

```
apps/web         SvelteKit app: upload, match list, match page, replay viewer
apps/worker      parse jobs: decompress, parse, build replays, save stats
packages/db      schema, migrations, queries
packages/replay  replay file format, map calibration (runs in the browser too)
packages/shared  storage layout and upload handling (server only)
```

## Development

Requires Node 22.18+ and pnpm 10.

```sh
pnpm install
pnpm dev
```

`pnpm dev` applies migrations, then starts the web app on http://localhost:5173 and the worker. With no accounts yet, the first request prints an admin invite link in the terminal. Data lives in `./data` unless `DATA_DIR` is set.

| Command                     | What it does                                       |
| --------------------------- | -------------------------------------------------- |
| `pnpm check`                | Type check every package                           |
| `pnpm test`                 | Run the tests                                      |
| `pnpm lint`                 | Check formatting                                   |
| `pnpm format`               | Format everything                                  |
| `pnpm build`                | Production build of the web app                    |
| `pnpm db:generate`          | Create a migration after a schema change           |
| `pnpm db:migrate`           | Apply migrations                                   |
| `pnpm demos:import <files>` | Queue demo files from disk, same as uploading them |
| `pnpm invite [--admin]`     | Print a new invite link                            |

In production the web app needs `BODY_SIZE_LIMIT=Infinity` (or e.g. `2G`), since adapter-node rejects request bodies over 512 KB by default and demos are a few hundred MB.

## Accounts

Everything requires signing in, and accounts only come from invite links.

- On first start (no accounts yet) the web app prints a one-time admin invite link to its log. Open it to create your account.
- Admins create more invite links in **Settings** (member or admin, valid once for 7 days), see open invites and remove people. Everyone can change their own password there.
- Invited people share one match library; each upload remembers who added it.
- Lost access? Create a fresh admin invite from the server: `pnpm invite --admin` (or `docker compose exec web node packages/db/src/invite.ts --admin`).

Passwords are hashed with scrypt; sessions last 30 days (extended while in use) in an http-only cookie. Logins are rate limited per name and address.

## Deploy

One image runs both parts: the web app (`apps/web/server.js`) and the worker (`apps/worker/src/index.ts`), sharing a `data` volume with the SQLite database, demos, replays and radar images. Back up that volume.

```sh
cp .env.example .env    # set ORIGIN to the address people will open
docker compose up -d --build
docker compose logs web # shows the admin invite link on first start
```

| Variable | Default                 | What it does                                                                                                                       |
| -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN` | `http://localhost:3000` | The public address, e.g. `https://demos.example.com`. Used for links and login protection, so it must match what the browser shows |
| `BIND`   | `127.0.0.1`             | Interface the port is published on. Keep it local and put a reverse proxy in front                                                 |
| `PORT`   | `3000`                  | Published port                                                                                                                     |

HTTPS via a reverse proxy, for example Caddy:

```
demos.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Behind a proxy, add `ADDRESS_HEADER=x-forwarded-for` to the web service so login rate limits see real client addresses (only set it when a proxy always adds that header). The worker needs outbound internet once per map to download radar images. Updating is `git pull && docker compose up -d --build`; migrations run when the web container starts.

## Roadmap

- [x] Project scaffold (web, worker, shared types)
- [x] Upload + parse a demo into replay blobs and stats
- [x] 2D radar viewer
- [x] Match list and scoreboards
- [ ] Auto-fetch via share codes + Game Coordinator
- [x] Auth with invite links
- [x] Docker image and compose setup
- [ ] Personal API tokens
- [ ] Companion extension (FACEIT and other sites)
- [ ] 3D viewer
