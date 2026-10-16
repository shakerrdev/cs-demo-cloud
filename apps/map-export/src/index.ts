import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { exportMap } from './export.ts';
import { exportPlayers } from './players.ts';
import { exportSkins, fetchCosmetics } from './skins.ts';
import { findCsgo } from './steam.ts';
import { defaultToolsDir, ensureTools } from './tools.ts';

const usage = `Exports CS2 maps as 3D map packs for cs-demo-cloud.

Usage: node apps/map-export/src/index.ts [options] <map> [map...]
       node apps/map-export/src/index.ts --players
       node apps/map-export/src/index.ts --skins <cosmetics.json | server url> [--token <api token>]

  --game <folder>   CS2 install folder (found through Steam if left out)
  --out <folder>    Where the packs go (default: ./map-packs)
  --tools <folder>  Where Source 2 Viewer CLI and gltfpack are kept
  --work <folder>   Temporary folder (default: system temp)
  --keep-work       Keep the temporary files
  --reuse-work      Reuse Source 2 Viewer output kept by --keep-work
  --max-texture-size <px>  Drop texture mips above this size (default 2048, 0 keeps all)
  --low-memory      Run Source 2 Viewer on one thread with less memory (slower, for 4 GB machines)
  --all             Every map in the game's maps folder
  --players         Player models, animations and weapons (players.zip)
  --skins <source>  Agents and weapon skins (skins.zip): "all" for every skin and agent in
                    the game, or only those your demos use, from the list in Settings or
                    straight from your server with --token
  --skin-texture-size <px>  Size of skin patterns (default 1024)
  --token <token>   API token for --skins <server url>

Example: node apps/map-export/src/index.ts de_dust2 de_mirage`;

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		game: { type: 'string' },
		out: { type: 'string', default: 'map-packs' },
		tools: { type: 'string' },
		work: { type: 'string' },
		'keep-work': { type: 'boolean', default: false },
		'reuse-work': { type: 'boolean', default: false },
		'max-texture-size': { type: 'string' },
		'low-memory': { type: 'boolean', default: false },
		all: { type: 'boolean', default: false },
		players: { type: 'boolean', default: false },
		skins: { type: 'string' },
		token: { type: 'string' },
		'skin-texture-size': { type: 'string' },
		help: { type: 'boolean', short: 'h', default: false }
	}
});

if (values.help || (!positionals.length && !values.all && !values.players && !values.skins)) {
	console.log(usage);
	process.exit(values.help ? 0 : 1);
}

const log = (message: string) => console.log(message);
if (values['low-memory'])
	Object.assign(process.env, {
		DOTNET_gcServer: '0',
		DOTNET_GCConserveMemory: '9',
		DOTNET_ThreadPool_ForceMinWorkerThreads: '1',
		DOTNET_ThreadPool_ForceMaxWorkerThreads: '1'
	});
const csgo = findCsgo(values.game);
log(`CS2: ${csgo}`);
const tools = await ensureTools(values.tools ?? defaultToolsDir(), log);

let maps = positionals.map((map) => map.replace(/\.vpk$/, '').toLowerCase());
if (values.all) {
	const { readdir } = await import('node:fs/promises');
	maps = (await readdir(join(csgo, 'maps')))
		.filter((file) => /^(de|cs|ar)_[a-z0-9_]+\.vpk$/.test(file) && !/_vanity\.vpk$/.test(file))
		.map((file) => file.replace(/\.vpk$/, ''));
}

let failed = 0;
if (values.players) {
	const started = Date.now();
	log('\n== players');
	try {
		const { pack, bytes } = await exportPlayers({
			csgo,
			outDir: resolve(values.out!),
			workDir: join(resolve(values.work ?? tmpdir()), 'cs-demo-cloud-players'),
			tools,
			log,
			keepWork: values['keep-work'],
			reuseWork: values['reuse-work']
		});
		log(
			`players: ${pack} (${(bytes / 1024 / 1024).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s)`
		);
	} catch (error) {
		failed++;
		console.error(`players failed: ${error instanceof Error ? error.message : error}`);
	}
}
if (values.skins) {
	const started = Date.now();
	log('\n== skins');
	try {
		const cosmetics =
			values.skins === 'all'
				? 'all'
				: await fetchCosmetics(values.skins, values.token ?? process.env.CDC_TOKEN);
		const { pack, bytes } = await exportSkins({
			csgo,
			outDir: resolve(values.out!),
			workDir: join(resolve(values.work ?? tmpdir()), 'cs-demo-cloud-skins'),
			tools,
			cosmetics,
			patternSize: values['skin-texture-size'] ? Number(values['skin-texture-size']) : undefined,
			log,
			keepWork: values['keep-work'],
			reuseWork: values['reuse-work']
		});
		log(
			`skins: ${pack} (${(bytes / 1024 / 1024).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s)`
		);
	} catch (error) {
		failed++;
		console.error(`skins failed: ${error instanceof Error ? error.message : error}`);
	}
}
for (const map of maps) {
	const started = Date.now();
	log(`\n== ${map}`);
	try {
		const { pack, bytes } = await exportMap({
			map,
			csgo,
			outDir: resolve(values.out!),
			workDir: join(resolve(values.work ?? tmpdir()), `cs-demo-cloud-${map}`),
			tools,
			log,
			keepWork: values['keep-work'] || values['reuse-work'],
			reuseWork: values['reuse-work'],
			maxTextureSize: Number(values['max-texture-size'] ?? 2048)
		});
		log(
			`${map}: ${pack} (${(bytes / 1024 / 1024).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s)`
		);
	} catch (error) {
		failed++;
		console.error(`${map} failed: ${error instanceof Error ? error.message : error}`);
	}
}
process.exit(failed ? 1 : 0);
