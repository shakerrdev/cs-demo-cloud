import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processModelGltf, repackBuffers, type Gltf } from './gltf.ts';

function sharedVertexGltf() {
	const positions = new Float32Array(100 * 3).map((_, i) => i);
	const uvs = new Float32Array(100 * 2).map((_, i) => -i);
	const first = new Uint16Array([0, 1, 2]);
	const second = new Uint16Array([97, 98, 99, 99, 98, 97]);
	const parts = [positions, uvs, first, second].map((array) => new Uint8Array(array.buffer));
	const bin = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	const bufferViews = parts.map((part) => {
		bin.set(part, offset);
		const view = { buffer: 0, byteOffset: offset, byteLength: part.length };
		offset += part.length;
		return view;
	});
	const gltf: Gltf = {
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 100, type: 'VEC3' },
			{ bufferView: 1, componentType: 5126, count: 100, type: 'VEC2' },
			{ bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
			{ bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' }
		],
		bufferViews,
		meshes: [
			{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }] },
			{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 3 }] }
		]
	};
	return { gltf, bin };
}

function read(gltf: Gltf, bin: Uint8Array, index: number): number[] {
	const accessor = gltf.accessors[index]!;
	const view = gltf.bufferViews[accessor.bufferView!]!;
	const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type as 'SCALAR']!;
	const size = accessor.componentType === 5126 ? 4 : 2;
	const stride = view.byteStride ?? components * size;
	const data = new DataView(bin.buffer, bin.byteOffset);
	const out: number[] = [];
	for (let i = 0; i < accessor.count; i++)
		for (let c = 0; c < components; c++) {
			const at = (view.byteOffset ?? 0) + i * stride + c * size;
			out.push(size === 4 ? data.getFloat32(at, true) : data.getUint16(at, true));
		}
	return out;
}

test('copies only the vertices each primitive of a shared buffer uses', () => {
	const { gltf, bin } = sharedVertexGltf();
	const result = repackBuffers(gltf, bin);
	assert.equal(result.compacted, 2);
	const [a, b] = gltf.meshes!.map((mesh) => mesh.primitives[0]!);
	assert.deepEqual(read(gltf, result.bin, a!.indices!), [0, 1, 2]);
	assert.deepEqual(read(gltf, result.bin, a!.attributes.POSITION!), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
	assert.deepEqual(read(gltf, result.bin, b!.indices!), [0, 1, 2, 2, 1, 0]);
	assert.deepEqual(
		read(gltf, result.bin, b!.attributes.TEXCOORD_0!),
		[-194, -195, -196, -197, -198, -199]
	);
	assert.deepEqual(gltf.accessors[b!.attributes.POSITION!]!.min, [291, 292, 293]);
	assert.deepEqual(gltf.accessors[b!.attributes.POSITION!]!.max, [297, 298, 299]);
	assert.ok(result.bin.length < 200);
	assert.equal(result.bin.length % 4, 0);
});

test('keeps the player skeleton, chosen meshes and world clips of a model', () => {
	const gltf: Gltf = {
		accessors: [],
		bufferViews: [],
		nodes: [
			{ name: 'model', children: [1] },
			{ name: 'root_motion', children: [2] },
			{ name: 'pelvis', translation: [0, 1, 0] },
			{ name: 'weapon_skeleton', children: [4] },
			{ name: 'weapon' },
			{ name: 'body', mesh: 0, skin: 0 },
			{ name: 'legacy', mesh: 1, skin: 0 }
		],
		meshes: [
			{
				name: 'm.body_hd',
				primitives: [{ attributes: { POSITION: 0, TEXCOORD_1: 1, JOINTS_0: 2 }, material: 0 }]
			},
			{ name: 'm.body_legacy', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }
		],
		materials: [
			{
				name: 'body',
				extras: {
					vmat: {
						Name: 'body',
						ShaderName: 'csgo_character.vfx',
						IntParams: {},
						FloatParams: {},
						VectorParams: {},
						TextureParams: { g_tColor: 'a.vtex', g_tBloodMask: 'b.vtex' }
					}
				}
			}
		],
		scenes: [{ nodes: [0, 3, 5, 6] }],
		skins: [{ joints: [1, 2] }],
		animations: [
			{
				name: 'animation/anims/world/rifle/idle_rifle',
				channels: [
					{ sampler: 0, target: { node: 4, path: 'rotation' } },
					{ sampler: 1, target: { node: 2, path: 'rotation' } }
				],
				samplers: ['weapon', 'pelvis']
			},
			{ name: 'animation/anims/viewmodel/idle_rifle', channels: [], samplers: [] }
		]
	};
	const result = processModelGltf(gltf, {
		skeletonRoot: 'root_motion',
		meshes: (name) => !name.endsWith('.body_legacy'),
		animations: (name) => name.startsWith('animation/anims/world/'),
		textureParams: new Set(['g_tColor'])
	});

	assert.deepEqual([...result.textures], ['a.vtex']);
	assert.deepEqual(result.clips, ['idle_rifle']);
	assert.deepEqual(result.nodes.pelvis, { translation: [0, 1, 0], rotation: undefined });
	assert.deepEqual(gltf.scenes, [{ nodes: [0, 5] }]);
	assert.equal(gltf.nodes![6]!.mesh, undefined);
	assert.deepEqual(gltf.meshes![0]!.primitives[0]!.attributes, { POSITION: 0, JOINTS_0: 2 });
	const [animation] = gltf.animations as { channels: unknown[]; samplers: unknown[] }[];
	assert.deepEqual(animation!.samplers, ['pelvis']);
	assert.deepEqual(animation!.channels, [{ sampler: 0, target: { node: 2, path: 'rotation' } }]);
});

test('keeps weapon rigs below their own root with prefixed bone names', () => {
	const gltf: Gltf = {
		accessors: [],
		bufferViews: [],
		nodes: [
			{ name: 'model', children: [1] },
			{ name: 'root_motion' },
			{ name: 'animation/skeletons/weapons/knife_bowie.vnmskel', children: [3] },
			{ name: 'weapon', children: [4] },
			{ name: 'weapon_offset' }
		],
		meshes: [],
		materials: [],
		scenes: [{ nodes: [0, 2] }],
		animations: [
			{
				name: 'animation/anims/viewmodel/knife/knife_bowie/idle1_bowie',
				channels: [
					{ sampler: 0, target: { node: 1, path: 'rotation' } },
					{ sampler: 1, target: { node: 3, path: 'rotation' } },
					{ sampler: 2, target: { node: 4, path: 'rotation' } }
				],
				samplers: ['root', 'weapon', 'offset']
			}
		]
	};
	processModelGltf(gltf, {
		skeletonRoot: 'root_motion',
		weaponRigs: true,
		animations: () => true,
		textureParams: new Set()
	});
	assert.deepEqual(gltf.scenes, [{ nodes: [0, 2] }]);
	assert.deepEqual(
		gltf.nodes!.slice(2).map((node) => node.name),
		['rig@knife_bowie', 'knife_bowie@weapon', 'knife_bowie@weapon_offset']
	);
	const [animation] = gltf.animations as { samplers: unknown[] }[];
	assert.deepEqual(animation!.samplers, ['root', 'offset']);
});

test('falls back to every mesh and can drop skins', () => {
	const gltf: Gltf = {
		accessors: [],
		bufferViews: [],
		nodes: [{ name: 'knife', mesh: 0, skin: 0 }],
		meshes: [{ name: 'k.body_legacy', primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1 } }] }],
		skins: [{ joints: [0] }]
	};
	processModelGltf(gltf, {
		meshes: (name) => !name.endsWith('.body_legacy'),
		dropSkins: true,
		textureParams: new Set()
	});
	assert.equal(gltf.nodes![0]!.mesh, 0);
	assert.equal(gltf.nodes![0]!.skin, undefined);
	assert.equal(gltf.skins, undefined);
	assert.deepEqual(gltf.meshes![0]!.primitives[0]!.attributes, { POSITION: 0 });
});

test('tags the materials of chosen meshes with their part', () => {
	const gltf: Gltf = {
		accessors: [],
		bufferViews: [],
		nodes: [
			{ name: 'body', mesh: 0 },
			{ name: 'arms', mesh: 1 }
		],
		meshes: [
			{ name: 'm.thirdperson_body', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
			{ name: 'm.firstperson_arms', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }
		],
		materials: [{ name: 'skin' }]
	};
	processModelGltf(gltf, {
		part: (name) => (name.includes('.firstperson_') ? 'firstperson' : null),
		textureParams: new Set()
	});
	assert.equal(gltf.meshes![0]!.primitives[0]!.material, 0);
	assert.equal(gltf.meshes![1]!.primitives[0]!.material, 1);
	assert.equal(gltf.materials![1]!.name, 'skin');
	assert.equal(gltf.materials![1]!.extras?.part, 'firstperson');
	assert.equal(gltf.materials![0]!.extras?.part, undefined);
});
