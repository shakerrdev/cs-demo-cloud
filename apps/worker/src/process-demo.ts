import { mkdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { saveMatch, type Db, type Demo } from '@cs-demo-cloud/db';
import { REPLAY_VERSION, encodeRound } from '@cs-demo-cloud/replay';
import type { Storage } from '@cs-demo-cloud/shared';
import { analyzeDemo } from './analyze.ts';
import { openDemoFile } from './decompress.ts';
import { ensureRadars } from './radars.ts';

const compress = promisify(gzip);

export interface WorkerContext {
	db: Db;
	storage: Storage;
	log: (message: string) => void;
}

export async function processDemo(demo: Demo, { db, storage, log }: WorkerContext): Promise<void> {
	const startedAt = performance.now();
	let lap = startedAt;
	const timings: string[] = [];
	const step = (name: string) => {
		const now = performance.now();
		timings.push(`${name} ${Math.round(now - lap)}ms`);
		lap = now;
	};

	const file = await openDemoFile(
		storage.demoPath(demo.id, demo.format),
		demo.format,
		storage.workDir
	);
	step('open');
	try {
		const analyzed = analyzeDemo(file.path, step);
		step('build');

		const replayDir = storage.replayDir(demo.id);
		await rm(replayDir, { recursive: true, force: true });
		await mkdir(replayDir, { recursive: true });
		let replayBytes = 0;
		for (const replay of analyzed.replays) {
			const compressed = await compress(encodeRound(replay), { level: 9 });
			replayBytes += compressed.length;
			await writeFile(storage.replayPath(demo.id, replay.meta.round), compressed);
		}
		step('replays');

		const parseMs = Math.round(performance.now() - startedAt);
		saveMatch(db, {
			match: {
				demoId: demo.id,
				map: analyzed.map,
				serverName: analyzed.serverName,
				platform: analyzed.platform,
				tickRate: analyzed.tickRate,
				durationSeconds: analyzed.durationSeconds,
				roundCount: analyzed.rounds.length,
				scoreA: analyzed.scoreA,
				scoreB: analyzed.scoreB,
				teamAName: analyzed.teamAName,
				teamBName: analyzed.teamBName,
				teamAStartSide: analyzed.teamAStartSide,
				replayVersion: REPLAY_VERSION,
				parseMs
			},
			players: analyzed.players.map((player) => ({ ...player, demoId: demo.id })),
			rounds: analyzed.rounds.map((round) => ({ ...round, demoId: demo.id })),
			kills: analyzed.kills.map((kill) => ({ ...kill, demoId: demo.id }))
		});

		await ensureRadars(storage, analyzed.map).catch((error: Error) =>
			log(`Radar for ${analyzed.map}: ${error.message}`)
		);

		log(
			`${demo.fileName}: ${analyzed.map} ${analyzed.scoreA}-${analyzed.scoreB}, ${analyzed.rounds.length} rounds, ` +
				`replays ${(replayBytes / 1048576).toFixed(1)} MB, ${timings.join(', ')}`
		);
	} finally {
		await file.cleanup();
	}
}
