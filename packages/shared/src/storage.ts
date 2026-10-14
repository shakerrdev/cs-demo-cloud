import { join } from 'node:path';
import { resolveDataDir } from './paths.ts';

export type DemoFormat = 'dem' | 'bz2' | 'gz' | 'zst';

const signatures: [DemoFormat, number[]][] = [
	['dem', [0x50, 0x42, 0x44, 0x45, 0x4d, 0x53, 0x32]],
	['bz2', [0x42, 0x5a, 0x68]],
	['gz', [0x1f, 0x8b]],
	['zst', [0x28, 0xb5, 0x2f, 0xfd]]
];

export function detectDemoFormat(head: Uint8Array): DemoFormat | undefined {
	return signatures.find(([, bytes]) => bytes.every((byte, i) => head[i] === byte))?.[0];
}

export function createStorage(dataDir = resolveDataDir()) {
	return {
		dataDir,
		uploadDir: join(dataDir, 'tmp', 'uploads'),
		workDir: join(dataDir, 'tmp', 'work'),
		demoPath: (id: string, format: DemoFormat) =>
			join(dataDir, 'demos', format === 'dem' ? `${id}.dem` : `${id}.dem.${format}`),
		replayDir: (id: string) => join(dataDir, 'replays', id),
		replayPath: (id: string, round: number) => join(dataDir, 'replays', id, `${round}.bin.gz`),
		radarPath: (map: string, lower = false) =>
			join(dataDir, 'maps', `${map}${lower ? '_lower' : ''}.png`),
		mapMeshPath: (map: string, version: number) =>
			join(dataDir, 'maps', `${map}.v${version}.mesh.gz`)
	};
}

export type Storage = ReturnType<typeof createStorage>;
