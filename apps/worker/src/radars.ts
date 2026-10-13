import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { maps } from '@cs-demo-cloud/replay';
import type { Storage } from '@cs-demo-cloud/shared';

const source =
	'https://raw.githubusercontent.com/akiver/cs-demo-manager/b45a5f29283590c3fd0fc6526564b49567c0b931/static/images/maps/cs2/radars';

export async function ensureRadars(storage: Storage, map: string): Promise<void> {
	const info = maps[map];
	if (!info) return;
	await download(`${source}/${map}.png`, storage.radarPath(map));
	if (info.lowerBelowZ !== null)
		await download(`${source}/${map}_lower.png`, storage.radarPath(map, true));
}

async function download(url: string, target: string): Promise<void> {
	if (existsSync(target)) return;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Radar download failed (${response.status}): ${url}`);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, new Uint8Array(await response.arrayBuffer()));
}
