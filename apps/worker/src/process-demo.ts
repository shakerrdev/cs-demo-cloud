import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';
import { getAppConfigJson, saveMatch, type Db, type Demo } from '@cs-demo-cloud/db';
import {
	MAP_MESH_VERSION,
	REPLAY_VERSION,
	collectCosmetics,
	decodeMapMesh,
	encodeRound,
	normalizeConfig
} from '@cs-demo-cloud/replay';
import type { Storage } from '@cs-demo-cloud/shared';
import { analyzeDemo } from './analyze.ts';
import { openDemoFile } from './decompress.ts';
import { computeFalls, computeImpacts } from './impacts.ts';
import { computeSmokeVolumes } from './smokes.ts';
import { ensureMapAssets } from './map-assets.ts';
import { MeshRaycaster } from './raycast.ts';

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
		const config = normalizeConfig(getAppConfigJson(db));
		const analyzed = analyzeDemo(file.path, step, { viewRate: config.parsing.viewRate });
		step('build');

		await ensureMapAssets(storage, analyzed.map, log);
		const raycaster = await loadRaycaster(storage, analyzed.map).catch((error: Error) => {
			log(`Bullet impacts for ${analyzed.map}: ${error.message}`);
			return null;
		});
		for (const replay of analyzed.replays) {
			replay.meta.impacts = computeImpacts(replay, raycaster);
			if (raycaster) {
				computeFalls(replay, raycaster);
				computeSmokeVolumes(replay, raycaster);
			}
			delete replay.meta.bullets;
		}
		step('impacts');

		const replayDir = storage.replayDir(demo.id);
		await rm(replayDir, { recursive: true, force: true });
		await mkdir(replayDir, { recursive: true });
		let replayBytes = 0;
		for (const replay of analyzed.replays) {
			const compressed = await compress(encodeRound(replay), { level: 9 });
			replayBytes += compressed.length;
			await writeFile(storage.replayPath(demo.id, replay.meta.round), compressed);
		}
		await writeFile(
			storage.cosmeticsPath(demo.id),
			JSON.stringify(collectCosmetics(analyzed.replays))
		);
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

		log(
			`${demo.fileName}: ${analyzed.map} ${analyzed.scoreA}-${analyzed.scoreB}, ${analyzed.rounds.length} rounds, ` +
				`replays ${(replayBytes / 1048576).toFixed(1)} MB, ${timings.join(', ')}`
		);
	} finally {
		await file.cleanup();
	}
}

async function loadRaycaster(storage: Storage, map: string): Promise<MeshRaycaster | null> {
	const path = storage.mapMeshPath(map, MAP_MESH_VERSION);
	if (!existsSync(path)) return null;
	return new MeshRaycaster(decodeMapMesh(gunzipSync(await readFile(path))));
}
