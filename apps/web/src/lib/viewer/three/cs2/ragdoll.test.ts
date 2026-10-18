import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { RAGDOLL_BONES, Ragdoll } from './ragdoll.ts';

const LAYOUT: Record<string, [string | null, number, number, number]> = {
	pelvis: [null, 0, 0, 40],
	spine_2: ['pelvis', 0, 0, 16],
	head_0: ['spine_2', 0, 0, 14],
	arm_upper_L: ['spine_2', 0, 8, 8],
	arm_lower_L: ['arm_upper_L', 0, 2, -12],
	hand_L: ['arm_lower_L', 0, 0, -11],
	arm_upper_R: ['spine_2', 0, -8, 8],
	arm_lower_R: ['arm_upper_R', 0, -2, -12],
	hand_R: ['arm_lower_R', 0, 0, -11],
	leg_upper_L: ['pelvis', 0, 4, -2],
	leg_lower_L: ['leg_upper_L', 0, 0, -18],
	ankle_L: ['leg_lower_L', 0, 0, -17],
	leg_upper_R: ['pelvis', 0, -4, -2],
	leg_lower_R: ['leg_upper_R', 0, 0, -18],
	ankle_R: ['leg_lower_R', 0, 0, -17]
};

function body(): THREE.Object3D {
	const root = new THREE.Object3D();
	const bones = new Map<string, THREE.Object3D>();
	for (const name of RAGDOLL_BONES) {
		const [parent, x, y, z] = LAYOUT[name]!;
		const bone = new THREE.Bone();
		bone.name = name;
		bone.position.set(x, y, z);
		(parent ? bones.get(parent)! : root).add(bone);
		bones.set(name, bone);
	}
	root.updateMatrixWorld(true);
	return root;
}

test('a standing body falls away from the shot and comes to rest on the floor', () => {
	const model = body();
	const ragdoll = new Ragdoll(model, { yaw: 0, room: 60, floor: 0, headshot: false, seed: 3 });
	assert.ok(ragdoll.complete);
	ragdoll.apply(3);
	model.updateMatrixWorld(true);
	const head = model.getObjectByName('head_0')!.getWorldPosition(new THREE.Vector3());
	const pelvis = model.getObjectByName('pelvis')!.getWorldPosition(new THREE.Vector3());
	assert.ok(head.z < 20, `head at ${head.z}`);
	assert.ok(pelvis.z < 20, `pelvis at ${pelvis.z}`);
	assert.ok(head.x > 10, `head moved ${head.x} along the push`);
	assert.ok(head.x < 60 + 18 + 1, 'stops at the wall');
});
