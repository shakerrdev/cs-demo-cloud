import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { exportMap } from './export.ts';
import { findCsgo } from './steam.ts';
import { defaultToolsDir, ensureTools } from './tools.ts';

const usage = `Exports CS2 maps as 3D map packs for cs-demo-cloud.

Usage: node apps/map-export/src/index.ts [options] <map> [map...]

  --game <folder>   CS2 install folder (found through Steam if left out)
  --out <folder>    Where the packs go (default: ./map-packs)
  --tools <folder>  Where Source 2 Viewer CLI and gltfpack are kept
  --work <folder>   Temporary folder (default: system temp)
  --keep-work       Keep the temporary files
  --reuse-work      Reuse Source 2 Viewer output kept by --keep-work
  --max-texture-size <px>  Drop texture mips above this size (smaller packs)
  --all             Every map in the game's maps folder

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
		all: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false }
	}
});

if (values.help || (!positionals.length && !values.all)) {
	console.log(usage);
	process.exit(values.help ? 0 : 1);
}

const log = (message: string) => console.log(message);
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
			maxTextureSize: Number(values['max-texture-size'] ?? 0)
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
