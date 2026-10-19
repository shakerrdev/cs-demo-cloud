import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { listMapPacks, mapPackDir, splitCombinedPacks } from './map-packs.ts';
import { createStorage } from './storage.ts';

function glb(textureParams: Record<string, string>): Uint8Array {
	const json = new TextEncoder().encode(
		JSON.stringify({ materials: [{ extras: { vmat: { TextureParams: textureParams } } }] })
	);
	const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
	padded.set(json);
	const out = new Uint8Array(20 + padded.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, padded.length, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(padded, 20);
	return out;
}

async function put(dir: string, files: Record<string, string | Uint8Array>) {
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
	}
}

test('splits installed combined packs into players, sounds, skins and agents', async () => {
	const dataDir = await mkdtemp(join(tmpdir(), 'cdc-packs-'));
	try {
		const storage = createStorage(dataDir);
		const texture = (file: string) => ({ file, format: 'bc1', width: 4, height: 4 });
		await put(mapPackDir(storage, 'players'), {
			'players.json': JSON.stringify({
				version: 1,
				exportedAt: '2026-10-19T00:00:00.000Z',
				build: '1.0',
				characters: { CT: 'ct.glb', T: 't.glb' },
				animations: 'anim.glb',
				weapons: {},
				textures: {},
				sounds: { 'shot:ak47': { files: ['sounds/ak.mp3'], volume: 1, pitch: 1, curve: [] } }
			}),
			'installed.json': '{}',
			'ct.glb': 'ct',
			't.glb': 't',
			'anim.glb': 'anim',
			'sounds/ak.mp3': 'bang'
		});
		await put(mapPackDir(storage, 'skins'), {
			'skins.json': JSON.stringify({
				version: 1,
				exportedAt: '2026-10-19T00:00:00.000Z',
				build: '1.0',
				agents: { agent_1: 'agents/agent_1.glb' },
				weapons: { ak47: { model: 'weapons/ak47.glb', textures: {} } },
				paints: { '44': { textures: { g_tPattern: 'paint.vtex' } } },
				gloves: {},
				textures: {
					'agent.vtex': texture('textures/agent.ktx2'),
					'shared.vtex': texture('textures/shared.ktx2'),
					'paint.vtex': texture('textures/paint.ktx2')
				}
			}),
			'installed.json': '{}',
			'agents/agent_1.glb': glb({ g_tColor: 'agent.vtex', g_tNormal: 'shared.vtex' }),
			'weapons/ak47.glb': glb({ g_tColor: 'shared.vtex' }),
			'textures/agent.ktx2': 'a',
			'textures/shared.ktx2': 's',
			'textures/paint.ktx2': 'p'
		});

		const split = await splitCombinedPacks(storage);
		assert.deepEqual(split.map((pack) => pack.map).sort(), [
			'agents',
			'players',
			'skins',
			'sounds'
		]);
		assert.deepEqual((await listMapPacks(storage)).map((pack) => pack.map).sort(), [
			'agents',
			'players',
			'skins',
			'sounds'
		]);

		const dir = (name: string) => mapPackDir(storage, name);
		const json = async (name: string, file: string) =>
			JSON.parse(await readFile(join(dir(name), file), 'utf8'));
		assert.equal((await json('players', 'players.json')).sounds, undefined);
		assert.ok(!existsSync(join(dir('players'), 'sounds/ak.mp3')));
		assert.ok(existsSync(join(dir('sounds'), 'sounds/ak.mp3')));
		assert.deepEqual(Object.keys((await json('sounds', 'sounds.json')).sounds), ['shot:ak47']);

		const skins = await json('skins', 'skins.json');
		assert.deepEqual(skins.agents, {});
		assert.deepEqual(Object.keys(skins.textures).sort(), ['paint.vtex', 'shared.vtex']);
		assert.ok(!existsSync(join(dir('skins'), 'agents/agent_1.glb')));
		assert.ok(!existsSync(join(dir('skins'), 'textures/agent.ktx2')));
		const agents = await json('agents', 'agents.json');
		assert.deepEqual(agents.agents, { agent_1: 'agents/agent_1.glb' });
		assert.deepEqual(Object.keys(agents.textures).sort(), ['agent.vtex', 'shared.vtex']);
		assert.ok(existsSync(join(dir('agents'), 'textures/shared.ktx2')));

		assert.deepEqual(await splitCombinedPacks(storage), []);
	} finally {
		await rm(dataDir, { recursive: true, force: true });
	}
});
