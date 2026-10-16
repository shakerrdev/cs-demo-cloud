# cs-demo-cloud

A lightweight, self-hosted CS2 demo manager that lives in the browser: it fetches your matches automatically, stores them, shows stats, and lets you actually **watch** them without launching CS2.

Invite-only multi-user, but built for one person first.

## Goals

- **Auto-fetch** new matchmaking demos (Premier, Competitive, Wingman) without manual downloads
- **Store** demos and parsed data cheaply
- **Watch** demos in the browser, on a 2D radar or in 3D
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

### Viewer

Both views share the same playback, HUD, kill feed and timeline; **V** switches between them.

- **2D radar**: players with view cones, health, bomb and kit, grenades in flight, smokes, fires, flashes, shots, kill markers, upper/lower level for Nuke, Vertigo and co. Plain Canvas 2D: ten players and some grenades don't need a WebGL engine.
- **3D**: the map's collision geometry rendered with three.js, floors coloured with the radar image, players as capsules facing where they aim, smokes, fires, flash and HE bursts, grenade trails, shots, the bomb and kill markers. Players, smokes and trails behind walls show through faintly. Cameras: **Free** (drag to pan, right-drag to rotate, scroll to zoom), **Follow** (orbits the selected player) and **POV** (the player's eye position and view angles). **Cut roofs** hides everything above the players. three.js only loads when you open the 3D view.

Map assets come from Valve's game files, which is fine for a private instance but not something to redistribute publicly, so none are committed here. The worker downloads them the first time it parses a demo on a map (and on start for maps it already has demos of) into `data/maps`:

- radar images (and lower-level images) from [CS Demo Manager](https://github.com/akiver/cs-demo-manager)'s repository at a pinned commit
- 3D geometry from [awpy-data](https://github.com/pnxenopoulos/awpy-data)'s release for game build 2000930: per-map collision meshes, read straight out of the release zip with range requests (about 1 MB per map downloaded, CRC-checked), quantized to 16 bits and stored gzipped (0.2 to 2.5 MB per map)

Map calibration (origin, scale, lower-level height) lives in `packages/replay/src/maps.ts`. Maps without awpy geometry still play in 2D.

### Game-look 3D maps

With a map pack installed, the 3D view shows the map as it looks in CS2 instead of the collision mesh: the real geometry and props with their textures, the baked lightmaps (irradiance, directional light and sun shadows), light probes for props, cube map reflections, the 3D skybox, the sky, cubemap and gradient fog, and the map's tonemap, bloom and colour grading. Matches on maps without a pack keep the simple view.

Packs are made from the game files on a PC with CS2 installed, then uploaded once:

1. Install [Node.js](https://nodejs.org) 22.18 or newer and pnpm, clone this repository and run `pnpm install`
2. Run `node apps/map-export/src/index.ts de_dust2 de_mirage` (or `--all`). It finds CS2 through Steam (or pass `--game <folder>`), and on the first run downloads [Source 2 Viewer](https://github.com/ValveResourceFormat/ValveResourceFormat) CLI 20.0 and [gltfpack](https://github.com/zeux/meshoptimizer) 1.3 into a local cache
3. In **Settings → 3D maps**, add the zip from `map-packs/` (admins only). Uploading a pack again replaces it

Source 2 Viewer exports geometry and materials as glTF; the exporter keeps the lightmap UVs, drops tool brushes, gives every mesh only the vertices it uses, compresses the meshes with meshopt and copies textures straight out of the VPKs in their GPU formats (BC1 to BC7, no re-encoding), plus small copies of big textures and lightmaps so the viewer can show the map before the full ones arrive. Lightmaps, probes, cube maps, sky, fog and post processing come from the world and entity lumps.

Packs are big because the game's textures are: Mirage about 320 MB, Dust II 760 MB, Ancient 1.2 GB, Overpass 1.7 GB, Cache 2 GB. Textures are capped at 2048 px by default (`--max-texture-size 0` keeps 4096 ones, `1024` halves the size). Source 2 Viewer needs a lot of memory for big maps (Inferno and Train don't fit in 4 GB); `--low-memory` helps on small machines at the cost of speed.

The viewer's **Textures** menu picks how much of that to use per device: auto (high unless the map's textures pass 1.2 GB, then medium), high, medium (1024 px) or low (only the small copies, nothing else is downloaded).

The browser needs S3TC and BPTC texture compression (any desktop GPU); phones without it keep the simple view.

### Player models

With a player pack installed as well, players in game-look maps are CS2's agents (SAS for CT, Phoenix for T) instead of capsules, holding the weapon they have out:

- `node apps/map-export/src/index.ts --players` writes `map-packs/players.zip` (about 130 MB), uploaded in **Settings → 3D maps** like a map
- it holds both agents with their first-person arms, the world-model animations (idle, walk, run and crouch in eight directions for rifles, pistols and knives, jumps, defusing, planting, weapon poses and shooting) and every weapon model, with textures capped at 1024 px (weapons 512 px)
- the viewer blends the clips from each player's speed, direction and stance, with the walk and run cycles following the distance covered so feet don't slide; weapon poses and recoil are layered on top, the upper body turns to the aim pitch, and the dead fall over where they died
- players behind walls still show through faintly in their team colour
- in **POV** you see the player's own arms and weapon with the game's first-person animations: drawing after a switch, idle, shooting, reloading, knife swings, grenade throws and planting

On game-look maps the effects are drawn to match: smokes are lit, noisy volumes that bloom over about a second and thin out at the end, molotovs burn as flickering flames with a glow on the ground, flashes and HEs burst brightly into the map's bloom, guns show muzzle flashes and tracers, and grenades and the bomb are their game models. Without a map pack the simple shapes stay.

The pack also carries the game's sounds (about 20 MB): every gun near and far, footsteps, landings, kills and headshots, flash, HE, smoke and molotov detonations with the fire loop, grenade bounces, and the bomb's plant, beeps, defuse and explosion. They play in both views with CS2's own volume-by-distance curves, positioned around you: in 3D from the followed player's head or near where the camera looks, in 2D from the selected player. **Sound on/off** (or **M**) toggles them; at 4× and faster footsteps and bounces are left out. Footsteps always use the concrete set, since replays don't know the surface.

Death animations and the AUG can't be read by Source 2 Viewer 20.0 yet, so deaths are a simple fall and the AUG isn't drawn.

### Skins and agents

Demos record each player's agent and the paint kit, pattern seed and wear of every gun and knife they hold (only real inventory items; picked-up weapons keep their owner's skin). A skins pack draws them:

- `node apps/map-export/src/index.ts --skins all` packs every skin and agent in the game (about 2,000 weapon and knife skins and 78 agents, about 1.6 GB, an hour or two the first time; it picks up where it stopped when run again with `--reuse-work`)
- or only what your demos use: **Settings → 3D maps** links that list; give it to the exporter with `--skins cosmetics.json`, or point it at your server with an API token: `--skins https://demos.example.com --token cdc_…`. `--skin-texture-size 512` makes either pack smaller
- it writes `map-packs/skins.zip` with the agent models (third person and first-person arms) and, for each paint kit, the weapon model it paints (the legacy model for older finishes), the pattern, wear and grunge textures and the kit's colours and settings; upload it like the other packs; the viewer only downloads the agents and skins a demo shows
- the viewer paints the weapons itself: custom paint jobs, gunsmith and patina finishes use their artwork; hydrographic, spray-paint, anodized and airbrushed finishes (fades, dopplers) colour the pattern or the weapon's masks with the kit's four colours, and wear strips paint where the wear texture is thinner than the item's float, revealing the base weapon and adding grime
- it's an approximation of the game's compositor: pattern seeds don't shift the pattern yet, and glitter, pearlescence and overlay effects of newer kits are left out
- gloves aren't in the demo data, so everyone keeps their agent's default gloves

## Demo sources

Upload is the primary way in and always works. Auto-fetch and import helpers build on top of it.

| Source              | How                                                                                                                                               | Notes                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload              | Drag and drop a `.dem` / `.dem.bz2` / `.dem.gz` / `.dem.zst`                                                                                      | Works for anything: matchmaking, FACEIT, scrims, servers                                                                                              |
| Valve matchmaking   | Steam Web API `GetNextMatchSharingCode` with your match-history auth code, then the Game Coordinator resolves each share code to a download URL   | Needs a logged-in Steam account for the GC (a separate bot account is safest). Download links expire about a month after the match, so fetch promptly |
| Companion extension | Browser extension / userscript that adds a "Send to cs-demo-cloud" button on sites like FACEIT and sends the demo with your own logged-in session | Works around platforms that lock demo downloads behind private APIs. Authenticates with a personal API token                                          |

### Uploading with an API token

Scripts, userscripts and browser extensions can upload as you with a personal token from **Settings → API tokens** (shown once; revoke it there any time):

```sh
curl -H "Authorization: Bearer cdc_…" \
  -H "Content-Type: application/octet-stream" \
  -H "X-File-Name: match.dem.gz" \
  --data-binary @match.dem.gz https://demos.example.com/api/demos
```

The answer is `{"id": "…", "duplicate": false}` (201, or 200 when the file is already in the library). Tokens work on every `/api/` route and nowhere else, and those routes answer CORS requests from any site, so a page script on FACEIT can call them directly. Demos uploaded with a token are marked as coming from an extension.

## Auto-import from Valve

The **Auto-import** page downloads new Premier, Competitive and Wingman matches on its own:

1. Every 10 minutes (or on **Check now**) the fetcher asks the Steam Web API (`GetNextMatchSharingCode`) for match codes newer than the last one it knows, for everyone who linked their account.
2. A **bot account** logs in, briefly launches CS2 and asks the Game Coordinator for each match's demo link, then logs off again.
3. The `.dem.bz2` is downloaded from Valve's replay servers and parsed like an upload. Teammates who both linked their accounts share one copy.

What it needs:

- **Each person**: their SteamID, their match history **auth code** and their **latest match code**, both from [Steam's CS2 match history page](https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128). Only matches from that code onwards can be found; Steam has no way to list older ones.
- **Admins, once**: a [Steam Web API key](https://steamcommunity.com/dev/apikey) and a **separate, free Steam account** for the bot. Logging in your own account would kick you out of CS2. The bot login supports Steam Guard email codes, app codes and app approval; the app keeps the login token (valid about 200 days, renewed automatically), never the password.

Valve keeps demos for about a month, so older matches show up as _Not available_. A failed download is retried up to 5 times; **Retry** puts it back in the queue. The fetcher runs as its own process (`apps/worker/src/fetcher.ts`, the `fetcher` service in Docker); set `VALVE_INTERVAL_MINUTES` to change how often it checks.

## Stack

- **TypeScript** end to end, run directly by Node (no build step outside the web app)
- **Parser**: [`@laihoe/demoparser2`](https://github.com/LaihoE/demoparser) (Rust core with Node bindings)
- **Steam/GC**: `steam-user` + `globaloffensive`
- **Web**: SvelteKit 3 (UI + API), adapter-node
- **Worker**: separate process for fetching and parsing, so the web app never blocks
- **DB**: SQLite via Drizzle, which also serves as the job queue
- **Viewer**: Canvas 2D for the radar, three.js (WebGL 2) for 3D
- **Storage**: local disk (`data/`): demos as uploaded, replays per round, radar images and 3D maps; S3-compatible storage later if needed
- **Deploy**: Docker Compose on a small VPS

## Layout

```
apps/web         SvelteKit app: upload, match list, match page, replay viewer
apps/worker      parse jobs: decompress, parse, build replays, save stats
apps/map-export  turns CS2 maps into 3D map packs (runs on a PC with CS2)
packages/db      schema, migrations, queries
packages/replay  replay, map mesh and map pack formats, map calibration (runs in the browser too)
packages/shared  storage layout, uploads, zip files and map packs (server only)
```

## Development

Requires Node 22.18+ and pnpm 10.

```sh
pnpm install
pnpm dev
```

`pnpm dev` applies migrations, then starts the web app on http://localhost:5173 and the worker (run `node apps/worker/src/fetcher.ts` too when working on auto-import). With no accounts yet, the first request prints an admin invite link in the terminal. Data lives in `./data` unless `DATA_DIR` is set.

| Command                     | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `pnpm check`                | Type check every package                                           |
| `pnpm test`                 | Run the tests                                                      |
| `pnpm lint`                 | Check formatting                                                   |
| `pnpm format`               | Format everything                                                  |
| `pnpm build`                | Production build of the web app                                    |
| `pnpm start`                | Run the production build: migrations, then web, worker and fetcher |
| `pnpm db:generate`          | Create a migration after a schema change                           |
| `pnpm db:migrate`           | Apply migrations                                                   |
| `pnpm demos:import <files>` | Queue demo files from disk, same as uploading them                 |
| `pnpm invite [--admin]`     | Print a new invite link                                            |

In production the web app needs `BODY_SIZE_LIMIT=Infinity` (or e.g. `2G`), since adapter-node rejects request bodies over 512 KB by default and demos are a few hundred MB.

## Run it at home

Runs on Windows, macOS and Linux, including a Raspberry Pi 4 (64-bit OS, 4 GB RAM or more). Needs Node 22.18+ (24 LTS recommended) and pnpm 10.

```sh
pnpm install
pnpm build
pnpm start
```

Open http://localhost:3000; the first start prints the admin invite link. Other devices on your network use `http://<this machine's IP>:3000`. Ctrl+C stops it. After `git pull`, run `pnpm install && pnpm build` again.

To bring in demos you already have, import CS2's replays folder (where in-game downloads end up) or any other folder:

```sh
pnpm demos:import "C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\replays"
```

| Variable        | Default             | What it does                                           |
| --------------- | ------------------- | ------------------------------------------------------ |
| `DATA_DIR`      | `./data`            | Demos, replays, radar images, 3D maps and temp files   |
| `DATABASE_PATH` | `<DATA_DIR>/app.db` | The SQLite database                                    |
| `PORT`          | `3000`              | Port                                                   |
| `HOST`          | `0.0.0.0`           | `127.0.0.1` keeps it to this machine                   |
| `ORIGIN`        | empty               | Only needed behind a reverse proxy or a public address |

### Raspberry Pi with a NAS

Demos are big (150–400 MB each), so on a Pi with only an SD card put them on a NAS and keep the database on the Pi. Mount a share (NFS works best, e.g. at `/mnt/nas`) and point `DATA_DIR` at it. Don't put the database on the share: SQLite's locking isn't reliable over network filesystems and its WAL mode needs the file on the machine that uses it. The database is only a few MB and rarely written, so the SD card is fine for it.

To start it on boot, save this as `/etc/systemd/system/cs-demo-cloud.service` (adjust user and paths), then `sudo systemctl enable --now cs-demo-cloud`:

```ini
[Unit]
Description=cs-demo-cloud
After=network-online.target
Wants=network-online.target
RequiresMountsFor=/mnt/nas

[Service]
User=pi
WorkingDirectory=/home/pi/cs-demo-cloud
Environment=DATA_DIR=/mnt/nas/cs-demo-cloud
Environment=DATABASE_PATH=/home/pi/cs-demo-cloud-db/app.db
ExecStart=/usr/bin/env node scripts/start.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`journalctl -u cs-demo-cloud` shows the log, including the first admin invite link.

## Accounts

Everything requires signing in, and accounts only come from invite links.

- On first start (no accounts yet) the web app prints a one-time admin invite link to its log. Open it to create your account.
- Admins create more invite links in **Settings** (member or admin, valid once for 7 days), see open invites and remove people. Everyone can change their own password there.
- Invited people share one match library; each upload remembers who added it.
- A demo can be deleted from its match page (or `DELETE /api/demos/<id>`) by the person who uploaded it and by admins; that removes the file, its replays and its stats. A demo that is being parsed right now can't be deleted until it's done.
- Lost access? Create a fresh admin invite from the server: `pnpm invite --admin`, or in Docker as described below.

Passwords are hashed with scrypt; sessions last 30 days (extended while in use) in an http-only cookie. Logins are rate limited per name and address.

## Docker (NAS or server)

Every push to `main` is checked, tested and published as `ghcr.io/shakerrdev/cs-demo-cloud:latest` (x86-64) by GitHub Actions, including a smoke test of the image. [`compose.yaml`](compose.yaml) runs it as three containers from that image: `web` (runs migrations, then the site), `worker` (parsing) and `fetcher` (auto-import from Valve). They share two folders next to the compose file: `data` (demos, replays, radar images) and `db` (the SQLite database). Back up both.

### UGREEN NAS (UGOS Pro)

1. Open **Docker → Project → Create**. Name it `cs-demo-cloud` and keep the suggested storage path (a folder in the `docker` shared folder).
2. Paste the contents of [`compose.yaml`](compose.yaml) and click **Deploy**. Docker pulls the image and starts both containers.
3. Open **Docker → Container → cs-demo-cloud-web-1 → Log**. It shows the one-time admin link, e.g. `http://localhost:3000/invite/…`. Replace `localhost` with the NAS's address (e.g. `http://192.168.1.20:3000/invite/…`), open it and create your account.
4. From then on the site is at `http://<nas-ip>:3000`.

`data` and `db` appear inside the project folder, so you can see and back them up in File Manager. The container fixes their ownership on start and then runs as uid 1000; set `PUID`/`PGID` to your NAS user's ids (`id` over SSH) if you want the files to belong to you. Port 3000 taken? Set `PORT` in the project's environment. To update: pull `ghcr.io/shakerrdev/cs-demo-cloud:latest` again (**Docker → Image**) and redeploy the project; migrations run automatically.

### Any other Docker host

```sh
curl -O https://raw.githubusercontent.com/shakerrdev/cs-demo-cloud/main/compose.yaml
docker compose up -d
docker compose logs web # the admin invite link
```

To build the image yourself instead: `docker build -t ghcr.io/shakerrdev/cs-demo-cloud:latest .` before `docker compose up -d`.

| Variable      | Default   | What it does                                                                                                                |
| ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PORT`        | `3000`    | Port on the host                                                                                                            |
| `BIND`        | `0.0.0.0` | Interface the port is published on. `127.0.0.1` when a reverse proxy on the same host is the only way in                    |
| `ORIGIN`      | empty     | The public address when it runs behind a reverse proxy, e.g. `https://demos.example.com`. Leave empty on your local network |
| `DATA_PATH`   | `./data`  | Host folder for demos, replays, radar images and 3D maps                                                                    |
| `DB_PATH`     | `./db`    | Host folder for the database. Keep it on a local disk of the machine running the containers, never on a network share       |
| `PUID`/`PGID` | `1000`    | User and group the app runs as and that owns the files                                                                      |

Put them in a `.env` file next to `compose.yaml` (see [`.env.example`](.env.example)) or in the project's environment settings.

HTTPS via a reverse proxy, for example Caddy (with `BIND=127.0.0.1` and `ORIGIN=https://demos.example.com`):

```
demos.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Behind a proxy, add `ADDRESS_HEADER=x-forwarded-for` to the web service so login rate limits see real client addresses (only when a proxy always adds that header). The worker needs outbound internet once per map to download radar images and 3D geometry.

Lost the admin account? Run `node packages/db/src/invite.ts --admin` in the web container (UGOS: **Container → cs-demo-cloud-web-1 → Terminal**, or `docker compose exec web node packages/db/src/invite.ts --admin`).

## Roadmap

- [x] Project scaffold (web, worker, shared types)
- [x] Upload + parse a demo into replay blobs and stats
- [x] 2D radar viewer
- [x] Match list and scoreboards
- [x] Auto-fetch via share codes + Game Coordinator
- [x] Auth with invite links
- [x] Docker image and compose setup
- [x] Published image with CI
- [x] 3D viewer
- [x] Personal API tokens
- [ ] Companion extension (FACEIT and other sites)
