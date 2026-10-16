import * as THREE from 'three';
import {
	viewmodelClips,
	weaponKey,
	weaponModelKey,
	type ReplaySkin,
	type RoundReplay,
	type Side
} from '@cs-demo-cloud/replay';
import type { PlayerState } from '../../frame.ts';
import type { MaterialExtras } from './material.ts';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
	GLTF_TO_SOURCE,
	isFirstPerson,
	skinAt,
	type PlayerPack,
	type ViewmodelAnimations
} from './players.ts';

const DEG = Math.PI / 180;
const FOV = 54;
const THROW_LEAD = 0.25;
const PLANT_SECONDS = 3.3;

interface Arms {
	model: THREE.Object3D;
	meshes: THREE.Mesh[];
	mixer: THREE.AnimationMixer;
	slot: THREE.Group;
	hand: THREE.Object3D;
	rigs: Map<string, THREE.Object3D>;
	borrowed: THREE.Object3D[];
	weapon: string | null;
	loading: string | null;
	action: THREE.AnimationAction | null;
}

interface Pose {
	clip: string;
	time: number;
	loop: boolean;
}

export class Viewmodel {
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 400);
	private root = new THREE.Group();
	private pack: PlayerPack;
	private arms = new Map<string, Arms>();
	private clips: Map<string, THREE.AnimationClip> | null = null;
	private rigs = new Map<string, THREE.Object3D>();
	private actions = new Map<string, THREE.AnimationAction>();
	onChange: (() => void) | null = null;

	constructor(pack: PlayerPack) {
		this.pack = pack;
		this.scene.add(this.root);
		this.root.rotation.order = 'ZYX';
		void pack.loadViewmodel().then((animations: ViewmodelAnimations) => {
			this.clips = animations.clips;
			this.rigs = animations.rigs;
			this.onChange?.();
		});
	}

	setShading() {
		for (const arms of this.arms.values()) {
			for (const mesh of arms.meshes) this.applyMaterial(mesh);
			arms.slot.traverse((object) => {
				if ((object as THREE.Mesh).isMesh) this.applyMaterial(object as THREE.Mesh);
			});
		}
	}

	update(
		replay: RoundReplay,
		tick: number,
		player: PlayerState | null,
		camera: THREE.PerspectiveCamera
	): boolean {
		this.root.visible = false;
		if (!player?.alive || !this.clips) return false;
		const key = weaponKey(player.weapon);
		const clips = viewmodelClips(key);
		if (!clips) return false;
		const pose = this.pose(replay, tick, player, clips);
		const clip = this.clips.get(pose.clip) ?? this.clips.get(clips.idle);
		if (!clip) return false;

		const agent = replay.meta.players[player.index]?.agent;
		const ready =
			agent && this.pack.template(player.side, agent) !== this.pack.template(player.side);
		if (agent && !ready && this.pack.hasAgent(agent))
			void this.pack.loadAgent(agent).then((template) => {
				if (template) this.onChange?.();
			});
		const armsKey = `${player.side}|${ready ? agent : ''}`;
		const arms = this.armsFor(armsKey, player.side, ready ? agent : undefined);
		for (const [id, other] of this.arms) other.model.visible = id === armsKey;
		const rig = this.rig(arms, clip);
		this.setWeapon(
			arms,
			weaponModelKey(key, player.side),
			skinAt(replay, player.index, tick, key),
			rig
		);

		const action = this.action(arms, clip);
		if (arms.action !== action) {
			arms.action?.stop();
			action.play();
			arms.action = action;
		}
		const duration = clip.duration;
		action.time =
			duration <= 0
				? 0
				: pose.loop
					? ((pose.time % duration) + duration) % duration
					: Math.min(duration, Math.max(0, pose.time));
		arms.mixer.update(0);

		this.root.position.copy(camera.position);
		this.root.rotation.set(0, player.pitch * DEG, player.yaw * DEG);
		this.root.visible = true;
		this.root.updateMatrixWorld(true);

		this.camera.position.copy(camera.position);
		this.camera.quaternion.copy(camera.quaternion);
		if (this.camera.aspect !== camera.aspect) {
			this.camera.aspect = camera.aspect;
			this.camera.updateProjectionMatrix();
		}
		this.camera.updateMatrixWorld();
		return true;
	}

	private pose(
		replay: RoundReplay,
		tick: number,
		player: PlayerState,
		clips: NonNullable<ReturnType<typeof viewmodelClips>>
	): Pose {
		const meta = replay.meta;
		const rate = meta.tickRate;
		const drawn = this.drawTick(replay, player.index, tick);
		const seconds = (tick - meta.startTick) / rate;
		const chosen: { pose: Pose | null; at: number } = {
			pose: drawn === null ? null : { clip: clips.draw, time: (tick - drawn) / rate, loop: false },
			at: drawn ?? -Infinity
		};
		const consider = (clip: string | undefined, at: number | null) => {
			if (!clip || at === null || at < chosen.at || at > tick) return;
			chosen.at = at;
			chosen.pose = { clip, time: (tick - at) / rate, loop: false };
		};
		consider(clips.shoot, lastEvent(meta.shots, player.index, tick));
		consider(clips.reload, lastEvent(meta.reloads, player.index, tick));
		const swing = lastEvent(meta.swings, player.index, tick);
		if (clips.attack && swing !== null)
			consider(clips.attack[countEvents(meta.swings, player.index, swing) % 2 ? 0 : 1], swing);
		if (clips.throw) {
			let thrown: number | null = null;
			for (const grenade of meta.grenades)
				if (grenade.thrower === player.index && grenade.path[0]! <= tick + THROW_LEAD * rate)
					thrown = Math.max(thrown ?? -Infinity, grenade.path[0]! - THROW_LEAD * rate);
			if (thrown !== null && thrown >= (drawn ?? -Infinity))
				consider(clips.throw, Math.min(tick, thrown));
		}
		if (clips.plant) {
			const plant = [...meta.bomb]
				.reverse()
				.find((event) => event.player === player.index && event.tick <= tick);
			if (plant?.type === 'plant_start' && (tick - plant.tick) / rate < PLANT_SECONDS)
				consider(clips.plant, plant.tick);
		}

		const pose = chosen.pose;
		if (pose && pose.time <= (this.clips?.get(pose.clip)?.duration ?? 0)) return pose;
		return { clip: clips.idle, time: seconds, loop: true };
	}

	private drawTick(replay: RoundReplay, index: number, tick: number): number | null {
		const { startTick, tickStep, frameCount } = replay.meta;
		const column = replay.columns.weapon;
		const base = index * frameCount;
		let frame = Math.max(0, Math.min(frameCount - 1, Math.floor((tick - startTick) / tickStep)));
		const weapon = column[base + frame];
		while (frame > 0 && column[base + frame - 1] === weapon) frame--;
		if (frame === 0) return null;
		return startTick + frame * tickStep;
	}

	private armsFor(id: string, side: Side, agent?: string): Arms {
		let arms = this.arms.get(id);
		if (arms) return arms;
		const { root } = this.pack.createModel(side, agent);
		const meshes: THREE.Mesh[] = [];
		root.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh) return;
			mesh.visible = isFirstPerson(mesh);
			if (mesh.visible) meshes.push(mesh);
		});
		root.matrixAutoUpdate = false;
		root.matrix.copy(GLTF_TO_SOURCE);
		const slot = new THREE.Group();
		slot.matrixAutoUpdate = false;
		const hand = root.getObjectByName('wpn') ?? root.getObjectByName('hand_R') ?? root;
		hand.add(slot);
		this.root.add(root);
		arms = {
			model: root,
			meshes,
			mixer: new THREE.AnimationMixer(root),
			slot,
			hand,
			rigs: new Map(),
			borrowed: [],
			weapon: null,
			loading: null,
			action: null
		};
		for (const mesh of meshes) this.applyMaterial(mesh);
		this.arms.set(id, arms);
		return arms;
	}

	private action(arms: Arms, clip: THREE.AnimationClip): THREE.AnimationAction {
		const key = `${arms.model.uuid}:${clip.name}`;
		let action = this.actions.get(key);
		if (!action) {
			action = arms.mixer.clipAction(clip);
			action.setLoop(THREE.LoopOnce, 1);
			action.clampWhenFinished = true;
			this.actions.set(key, action);
		}
		return action;
	}

	private rig(arms: Arms, clip: THREE.AnimationClip): string | null {
		const track = clip.tracks.find((t) => t.name.includes('@'));
		if (!track) return null;
		const name = track.name.slice(0, track.name.indexOf('@'));
		if (arms.rigs.has(name)) return name;
		const template = this.rigs.get(name);
		if (!template) return null;
		const rig = template.clone();
		rig.position.set(0, 0, 0);
		rig.quaternion.identity();
		rig.scale.set(1, 1, 1);
		arms.hand.add(rig);
		arms.rigs.set(name, rig);
		return name;
	}

	private setWeapon(arms: Arms, key: string | null, skin: ReplaySkin | null, rig: string | null) {
		const base = key && skin ? `${key}|${skin.paint}|${skin.wear}` : key;
		const id = base && `${base}|${rig ?? ''}`;
		if (id === arms.weapon) return;
		arms.weapon = id;
		arms.slot.clear();
		for (const object of arms.borrowed) object.removeFromParent();
		arms.borrowed = [];
		if (!key || !id) return;
		arms.loading = id;
		void this.pack.weapon(key, skin).then((template) => {
			if (arms.loading !== id || arms.weapon !== id || !template) return;
			arms.loading = null;
			const weapon = cloneSkinned(template.scene);
			weapon.traverse((object) => {
				if ((object as THREE.Mesh).isMesh) this.applyMaterial(object as THREE.Mesh);
			});
			arms.slot.matrix.copy(template.offset);
			arms.slot.add(weapon);
			const root = rig ? arms.rigs.get(rig) : undefined;
			if (rig && root) this.bindToRig(arms, weapon, rig, root);
			this.onChange?.();
		});
	}

	private bindToRig(arms: Arms, weapon: THREE.Object3D, rig: string, root: THREE.Object3D) {
		const mapped = new Map<THREE.Object3D, THREE.Object3D>();
		const map = (bone: THREE.Object3D): THREE.Object3D => {
			const known = mapped.get(bone);
			if (known) return known;
			let target =
				root.name === `${rig}@${bone.name}` ? root : root.getObjectByName(`${rig}@${bone.name}`);
			if (!target) {
				const parent = bone.parent && (bone.parent as THREE.Bone).isBone ? map(bone.parent) : root;
				parent.add(bone);
				arms.borrowed.push(bone);
				target = bone;
			}
			mapped.set(bone, target);
			return target;
		};
		const meshes: THREE.SkinnedMesh[] = [];
		weapon.traverse((object) => {
			if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh);
		});
		for (const mesh of meshes) {
			const bones = mesh.skeleton.bones.map((bone) => map(bone) as THREE.Bone);
			mesh.bind(new THREE.Skeleton(bones, mesh.skeleton.boneInverses), mesh.bindMatrix);
		}
	}

	private applyMaterial(mesh: THREE.Mesh) {
		const extras = (mesh.userData.extras ?? {}) as MaterialExtras;
		const material = this.pack.material(extras);
		if (!material) return;
		mesh.material = material;
		this.pack.promote(extras);
	}

	dispose() {
		for (const arms of this.arms.values()) arms.mixer.stopAllAction();
		this.arms.clear();
		this.actions.clear();
	}
}

function lastEvent(events: number[] | undefined, player: number, tick: number): number | null {
	if (!events) return null;
	let last: number | null = null;
	for (let i = 0; i < events.length; i += 2) {
		if (events[i]! > tick) break;
		if (events[i + 1] === player) last = events[i]!;
	}
	return last;
}

function countEvents(events: number[] | undefined, player: number, upTo: number): number {
	if (!events) return 0;
	let count = 0;
	for (let i = 0; i < events.length; i += 2) {
		if (events[i]! > upTo) break;
		if (events[i + 1] === player) count++;
	}
	return count;
}
