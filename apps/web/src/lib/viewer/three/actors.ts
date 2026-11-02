import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
	FLAG_ALIVE,
	type GrenadeType,
	type ReplayKill,
	type ReplayPlayer,
	type RoundReplay,
	type Side
} from '@cs-demo-cloud/replay';
import { recentFootsteps } from '../audio.ts';
import { bombState, grenadePosition, type PlayerState } from '../frame.ts';

export const sideColors: Record<Side, number> = { CT: 0x5aa9e6, T: 0xe8b04a };

const grenadeColors: Record<GrenadeType, number> = {
	smoke: 0xd4d9e0,
	flash: 0xffffff,
	he: 0xff6a3d,
	molotov: 0xff9a2e,
	decoy: 0x9aa4ae
};

const STAND_HEIGHT = 72;
const CROUCH_HEIGHT = 54;
export const STAND_EYE = 64;
export const CROUCH_EYE = 46;
const SMOKE_RADIUS = 144;
const FIRE_RADIUS = 110;
const SHOT_LENGTH = 420;
const SHOT_TICKS = 6;
const STEP_SECONDS = 0.7;
const STEP_RADIUS = 110;
const DEG = Math.PI / 180;
const STRIDE = 42;

export function eyeHeight(player: PlayerState): number {
	return player.ducking ? CROUCH_EYE : STAND_EYE;
}

export function aimDirection(player: PlayerState, target = new THREE.Vector3()): THREE.Vector3 {
	const yaw = player.yaw * DEG;
	const pitch = player.pitch * DEG;
	return target.set(
		Math.cos(pitch) * Math.cos(yaw),
		Math.cos(pitch) * Math.sin(yaw),
		-Math.sin(pitch)
	);
}

function hiddenPart(material: THREE.Material): THREE.Material {
	material.transparent = true;
	material.depthWrite = false;
	material.depthFunc = THREE.GreaterDepth;
	return material;
}

class Pool {
	private items: THREE.Mesh[] = [];
	private ghosts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
	private used = 0;
	private parent: THREE.Object3D;
	private create: () => THREE.Mesh;
	private ghostOpacity: number;

	constructor(parent: THREE.Object3D, create: () => THREE.Mesh, ghostOpacity = 0) {
		this.parent = parent;
		this.create = create;
		this.ghostOpacity = ghostOpacity;
	}

	begin() {
		this.used = 0;
	}

	next<M extends THREE.Material = THREE.MeshBasicMaterial>(): THREE.Mesh<THREE.BufferGeometry, M> {
		let item = this.items[this.used];
		if (!item) {
			item = this.create();
			this.items.push(item);
			this.parent.add(item);
			if (this.ghostOpacity > 0) {
				const material = hiddenPart(
					new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
				) as THREE.MeshBasicMaterial;
				const ghost = new THREE.Mesh(item.geometry, material);
				ghost.renderOrder = 4;
				item.add(ghost);
				this.ghosts.push(ghost);
			}
		}
		item.visible = true;
		this.used++;
		return item as THREE.Mesh<THREE.BufferGeometry, M>;
	}

	end() {
		for (let i = this.used; i < this.items.length; i++) this.items[i]!.visible = false;
		for (let i = 0; i < Math.min(this.used, this.ghosts.length); i++) {
			const source = this.items[i]!.material as THREE.MeshBasicMaterial;
			const ghost = this.ghosts[i]!.material;
			ghost.color.copy(source.color);
			ghost.opacity = source.opacity * this.ghostOpacity;
		}
	}

	dispose() {
		for (const item of this.items) (item.material as THREE.Material).dispose();
		for (const ghost of this.ghosts) ghost.material.dispose();
	}
}

class Lines {
	readonly object: THREE.LineSegments;
	private positions = new Float32Array(0);
	private colors = new Float32Array(0);
	private count = 0;

	constructor(material: THREE.LineBasicMaterial, ghostOpacity: number) {
		this.object = new THREE.LineSegments(new THREE.BufferGeometry(), material);
		this.object.frustumCulled = false;
		const hidden = hiddenPart(material.clone());
		hidden.opacity = material.opacity * ghostOpacity;
		const ghost = new THREE.LineSegments(this.object.geometry, hidden);
		ghost.frustumCulled = false;
		ghost.renderOrder = 4;
		this.object.add(ghost);
		this.grow();
	}

	begin() {
		this.count = 0;
	}

	add(a: THREE.Vector3Like, b: THREE.Vector3Like, color: THREE.Color, fade = 1) {
		if ((this.count + 2) * 3 > this.positions.length) this.grow();
		const i = this.count * 3;
		this.positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i);
		this.colors.set([color.r, color.g, color.b, color.r * fade, color.g * fade, color.b * fade], i);
		this.count += 2;
	}

	end() {
		const geometry = this.object.geometry;
		(geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
		(geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
		geometry.setDrawRange(0, this.count);
	}

	private grow() {
		const size = Math.max(1536, this.positions.length * 2);
		const positions = new Float32Array(size);
		const colors = new Float32Array(size);
		positions.set(this.positions);
		colors.set(this.colors);
		this.positions = positions;
		this.colors = colors;
		const geometry = this.object.geometry;
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
		);
		geometry.setAttribute(
			'color',
			new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage)
		);
	}

	dispose() {
		this.object.geometry.dispose();
		for (const child of this.object.children)
			((child as THREE.LineSegments).material as THREE.Material).dispose();
	}
}

interface PlayerActor {
	group: THREE.Group;
	rig: THREE.Group;
	body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
	skull: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
	legs: [THREE.Group, THREE.Group];
	legMaterial: THREE.MeshLambertMaterial;
	ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	head: THREE.Group;
	nose: THREE.Mesh;
	walk: { x: number; y: number; tick: number; distance: number; speed: number };
	aim: THREE.Line;
	marker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	side: Side;
}

const FALL_SECONDS = 0.45;

export class Actors {
	readonly root = new THREE.Group();
	private bodyGeometry = new THREE.CapsuleGeometry(16, STAND_HEIGHT - 32, 4, 12);
	private noseGeometry = new THREE.BoxGeometry(28, 3.5, 6);
	private torsoGeometry = new THREE.CapsuleGeometry(11, 16, 4, 10);
	private skullGeometry = new THREE.SphereGeometry(8, 16, 12);
	private legGeometry = new THREE.CapsuleGeometry(5.5, 24, 3, 8);
	private aimGeometry = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(0, 0, 0),
		new THREE.Vector3(900, 0, 0)
	]);
	private players: PlayerActor[] = [];
	private deaths: THREE.InstancedMesh;
	private grenadeHeads: THREE.InstancedMesh;
	private trails = new Lines(
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }),
		0.4
	);
	private path = new Lines(
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
		0.35
	);
	private shots = new Lines(
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
		0.3
	);
	private sphere = new THREE.SphereGeometry(1, 24, 16);
	private disc = new THREE.CircleGeometry(1, 40);
	private ring = new THREE.RingGeometry(0.82, 1, 48);
	private stepRing = new THREE.RingGeometry(0.93, 1, 48);
	private smokes: Pool;
	private fires: Pool;
	private blasts: Pool;
	private rings: Pool;
	private steps: Pool;
	private bomb: THREE.Mesh;
	private color = new THREE.Color();
	private color2 = new THREE.Color();
	private shotColor = new THREE.Color();
	private matrix = new THREE.Matrix4();
	private vector = new THREE.Vector3();
	private vector2 = new THREE.Vector3();
	private capsules = true;
	private simpleEffects = true;
	private footsteps = true;

	constructor() {
		this.bodyGeometry.rotateX(Math.PI / 2);
		this.bodyGeometry.translate(0, 0, STAND_HEIGHT / 2);
		this.noseGeometry.translate(14, -6, -13);
		this.torsoGeometry.rotateX(Math.PI / 2);
		this.torsoGeometry.translate(0, 0, 46);
		this.legGeometry.rotateX(Math.PI / 2);
		this.legGeometry.translate(0, 0, -17.5);

		const arm = new THREE.BoxGeometry(34, 6, 2);
		const cross = mergeGeometries([
			arm.clone().rotateZ(Math.PI / 4),
			arm.clone().rotateZ(-Math.PI / 4)
		])!;
		arm.dispose();
		this.deaths = new THREE.InstancedMesh(cross, new THREE.MeshBasicMaterial(), 64);
		this.deaths.count = 0;
		this.deaths.frustumCulled = false;

		this.grenadeHeads = new THREE.InstancedMesh(
			new THREE.SphereGeometry(5, 12, 8),
			new THREE.MeshBasicMaterial(),
			48
		);
		this.grenadeHeads.count = 0;
		this.grenadeHeads.frustumCulled = false;

		this.smokes = new Pool(
			this.root,
			() =>
				new THREE.Mesh(
					this.sphere,
					new THREE.MeshLambertMaterial({
						color: 0xc6ccd4,
						transparent: true,
						depthWrite: false
					})
				),
			0.45
		);
		this.fires = new Pool(
			this.root,
			() => {
				const mesh = new THREE.Mesh(
					this.disc,
					new THREE.MeshBasicMaterial({
						color: 0xff6228,
						transparent: true,
						depthWrite: false,
						side: THREE.DoubleSide,
						blending: THREE.AdditiveBlending
					})
				);
				mesh.renderOrder = 2;
				return mesh;
			},
			0.6
		);
		this.blasts = new Pool(
			this.root,
			() =>
				new THREE.Mesh(
					this.sphere,
					new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
				)
		);
		this.steps = new Pool(
			this.root,
			() =>
				new THREE.Mesh(
					this.stepRing,
					new THREE.MeshBasicMaterial({
						transparent: true,
						depthWrite: false,
						side: THREE.DoubleSide
					})
				),
			0.5
		);
		this.rings = new Pool(
			this.root,
			() =>
				new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({
						transparent: true,
						depthWrite: false,
						side: THREE.DoubleSide
					})
				),
			0.6
		);

		this.bomb = new THREE.Mesh(
			new THREE.BoxGeometry(16, 10, 6),
			new THREE.MeshLambertMaterial({ color: 0xef4b4b, emissive: 0x501010 })
		);
		this.bomb.visible = false;
		this.bomb.add(
			new THREE.Mesh(
				this.bomb.geometry,
				hiddenPart(new THREE.MeshBasicMaterial({ color: 0xef4b4b, opacity: 0.5 }))
			)
		);

		this.root.add(
			this.deaths,
			this.grenadeHeads,
			this.trails.object,
			this.shots.object,
			this.path.object,
			this.bomb
		);
	}

	setPlayers(players: ReplayPlayer[]) {
		while (this.players.length < players.length) this.players.push(this.createPlayer());
		this.players.forEach((actor, i) => {
			const player = players[i];
			actor.group.visible = false;
			if (!player) return;
			actor.side = player.side;
			actor.body.material.color.setHex(sideColors[player.side]);
			actor.skull.material.color
				.setHex(sideColors[player.side])
				.lerp(new THREE.Color(0xf1e3d3), 0.55);
			actor.legMaterial.color.setHex(sideColors[player.side]).multiplyScalar(0.55);
			actor.ghost.material.color.setHex(sideColors[player.side]);
			actor.marker.material.color.setHex(sideColors[player.side]);
			(actor.aim.material as THREE.LineBasicMaterial).color.setHex(sideColors[player.side]);
		});
	}

	setCapsules(visible: boolean) {
		this.capsules = visible;
	}

	setFootsteps(visible: boolean) {
		this.footsteps = visible;
	}

	setSimpleEffects(visible: boolean) {
		this.simpleEffects = visible;
	}

	bodies(): THREE.Object3D[] {
		return this.players
			.filter((actor) => actor.group.visible && actor.rig.visible)
			.flatMap((actor) => [actor.body, actor.skull, ...actor.legs.map((leg) => leg.children[0]!)]);
	}

	indexOf(object: THREE.Object3D): number {
		return this.players.findIndex((actor) => actor === object.userData.actor);
	}

	update(
		replay: RoundReplay,
		tick: number,
		players: PlayerState[],
		focus: number | null,
		pov: number | null,
		sizeOf: (player: PlayerState) => number,
		path: number | null = null
	) {
		this.updatePlayers(players, focus, pov, sizeOf, tick, replay.meta.kills, replay.meta.tickRate);
		this.updateDeaths(replay.meta.kills, replay.meta.players, tick);
		this.updateGrenades(replay, tick);
		this.updateEffects(replay, tick);
		this.updateBomb(replay, tick);
		this.grenadeHeads.visible = this.simpleEffects;
		if (!this.simpleEffects) this.bomb.visible = false;
		this.updateShots(replay, tick, players, pov);
		this.updateSteps(replay, tick, pov);
		this.updatePath(replay, tick, path);
	}

	private updatePath(replay: RoundReplay, tick: number, player: number | null) {
		this.path.begin();
		const { meta, columns } = replay;
		if (player !== null && meta.players[player]) {
			const n = meta.frameCount;
			const from = Math.max(
				0,
				Math.floor(((meta.freezeEndTick ?? meta.startTick) - meta.startTick) / meta.tickStep)
			);
			const now = (tick - meta.startTick) / meta.tickStep;
			const color = this.color.setHex(sideColors[meta.players[player]!.side]);
			const future = this.color2.copy(color).multiplyScalar(0.35);
			let previous = -1;
			for (let f = from; f < n; f += 2) {
				const at = player * n + f;
				if (!(columns.flags[at]! & FLAG_ALIVE)) {
					previous = -1;
					continue;
				}
				if (previous >= 0) {
					this.vector.set(columns.x[previous]!, columns.y[previous]!, columns.z[previous]! + 4);
					this.vector2.set(columns.x[at]!, columns.y[at]!, columns.z[at]! + 4);
					this.path.add(this.vector, this.vector2, f <= now ? color : future);
				}
				previous = at;
			}
		}
		this.path.end();
	}

	private createPlayer(): PlayerActor {
		const group = new THREE.Group();
		const rig = new THREE.Group();
		const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
		const body = new THREE.Mesh(this.torsoGeometry, material);
		const legMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
		const legs = [-1, 1].map((side) => {
			const leg = new THREE.Group();
			leg.position.set(0, side * 6, 34);
			leg.add(new THREE.Mesh(this.legGeometry, legMaterial));
			return leg;
		}) as [THREE.Group, THREE.Group];
		rig.add(body, ...legs);
		const ghost = new THREE.Mesh(
			this.bodyGeometry,
			hiddenPart(new THREE.MeshBasicMaterial({ opacity: 0.32 })) as THREE.MeshBasicMaterial
		);
		ghost.renderOrder = 3;
		const head = new THREE.Group();
		const skull = new THREE.Mesh(
			this.skullGeometry,
			new THREE.MeshLambertMaterial({ color: 0xffffff })
		);
		const nose = new THREE.Mesh(
			this.noseGeometry,
			new THREE.MeshLambertMaterial({ color: 0x2a2d33 })
		);
		const aim = new THREE.Line(
			this.aimGeometry,
			new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 })
		);
		head.add(skull, nose, aim);
		const marker = new THREE.Mesh(
			this.ring,
			new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, side: THREE.DoubleSide })
		);
		marker.position.z = 2;
		marker.scale.setScalar(28);
		group.add(rig, ghost, head, marker);
		group.visible = false;
		this.root.add(group);
		const actor: PlayerActor = {
			group,
			rig,
			body,
			skull,
			legs,
			legMaterial,
			ghost,
			head,
			nose,
			aim,
			marker,
			side: 'CT',
			walk: { x: 0, y: 0, tick: -1, distance: 0, speed: 0 }
		};
		for (const part of [body, skull, ...legs.map((leg) => leg.children[0]!)])
			part.userData.actor = actor;
		return actor;
	}

	private updatePlayers(
		players: PlayerState[],
		focus: number | null,
		pov: number | null,
		sizeOf: (player: PlayerState) => number,
		tick: number,
		kills: ReplayKill[],
		tickRate: number
	) {
		players.forEach((player, i) => {
			const actor = this.players[i];
			if (!actor) return;
			if (!player.alive && player.present && this.capsules && i !== pov) {
				const death = kills.find((kill) => kill.victim === i && kill.tick <= tick);
				actor.group.visible = death !== undefined;
				if (death) {
					const fall = Math.min(1, (tick - death.tick) / (FALL_SECONDS * tickRate));
					this.placeCorpse(actor, death, player, sizeOf(player), fall);
				}
				return;
			}
			const visible = player.alive && player.present && i !== pov;
			actor.group.visible = visible;
			if (!visible) return;

			actor.group.position.set(player.x, player.y, player.z);
			actor.group.rotation.set(0, 0, player.yaw * DEG, 'XYZ');
			actor.group.scale.setScalar(sizeOf(player));
			const crouch = player.ducking ? CROUCH_HEIGHT / STAND_HEIGHT : 1;
			actor.ghost.scale.set(1, 1, crouch);
			actor.head.position.set(0, 0, eyeHeight(player));
			actor.head.rotation.set(0, player.pitch * DEG, 0);
			actor.rig.visible = this.capsules;
			actor.skull.visible = this.capsules;
			actor.ghost.visible = this.capsules;
			actor.nose.visible = this.capsules;
			actor.rig.scale.set(1, 1, crouch);
			this.stride(actor, player, tick);
			actor.aim.visible = i === focus;
			actor.marker.visible = i === focus;
			actor.body.material.emissive.setScalar(player.blind * 0.8);
		});
	}

	private placeCorpse(
		actor: PlayerActor,
		death: ReplayKill,
		player: PlayerState,
		size: number,
		fall: number
	) {
		const eased = fall * fall;
		actor.group.position.set(death.x, death.y, death.z + 3 * eased);
		actor.group.rotation.set(0, (-Math.PI / 2) * eased, player.yaw * DEG, 'ZYX');
		actor.group.scale.setScalar(size);
		actor.rig.visible = true;
		actor.rig.scale.set(1, 1, 1);
		actor.skull.visible = true;
		actor.head.position.set(0, 0, STAND_EYE);
		actor.head.rotation.set(0, 0, 0);
		actor.nose.visible = false;
		actor.ghost.visible = false;
		actor.aim.visible = false;
		actor.marker.visible = false;
		actor.legs[0].rotation.y = 0.12;
		actor.legs[1].rotation.y = -0.08;
		actor.body.material.emissive.setScalar(0);
		actor.walk.tick = -1;
	}

	private stride(actor: PlayerActor, player: PlayerState, tick: number) {
		const walk = actor.walk;
		const elapsed = tick - walk.tick;
		const moved = Math.hypot(player.x - walk.x, player.y - walk.y);
		if (walk.tick < 0 || elapsed <= 0 || elapsed > 64 || moved > 200) {
			if (elapsed !== 0) walk.speed = 0;
		} else {
			walk.distance += moved;
			const speed = (moved / elapsed) * 64;
			walk.speed += (speed - walk.speed) * Math.min(1, elapsed / 8);
		}
		walk.x = player.x;
		walk.y = player.y;
		walk.tick = tick;
		const amount = Math.min(1, walk.speed / 250) * (player.ducking ? 0.5 : 1);
		const swing = Math.sin((walk.distance / STRIDE) * Math.PI) * 0.55 * amount;
		actor.legs[0].rotation.y = swing;
		actor.legs[1].rotation.y = -swing;
	}

	private updateDeaths(kills: ReplayKill[], players: ReplayPlayer[], tick: number) {
		let count = 0;
		for (const kill of this.capsules ? kills : []) {
			if (kill.tick > tick || count >= this.deaths.instanceMatrix.count) continue;
			const victim = players[kill.victim];
			if (!victim || this.players[kill.victim]) continue;
			this.matrix.makeTranslation(kill.x, kill.y, kill.z + 2);
			this.deaths.setMatrixAt(count, this.matrix);
			this.deaths.setColorAt(count, this.color.setHex(sideColors[victim.side]));
			count++;
		}
		this.deaths.count = count;
		this.deaths.instanceMatrix.needsUpdate = true;
		if (this.deaths.instanceColor) this.deaths.instanceColor.needsUpdate = true;
	}

	private updateGrenades(replay: RoundReplay, tick: number) {
		let count = 0;
		this.trails.begin();
		for (const grenade of replay.meta.grenades) {
			const position = grenadePosition(grenade.path, tick);
			if (!position) continue;
			const color = this.color.setHex(grenadeColors[grenade.type]);
			const path = grenade.path;
			for (let i = 0; i < position.segment; i++) {
				this.vector.set(path[i * 4 + 1]!, path[i * 4 + 2]!, path[i * 4 + 3]!);
				this.vector2.set(path[i * 4 + 5]!, path[i * 4 + 6]!, path[i * 4 + 7]!);
				this.trails.add(this.vector, this.vector2, color);
			}
			this.vector.set(
				path[position.segment * 4 + 1]!,
				path[position.segment * 4 + 2]!,
				path[position.segment * 4 + 3]!
			);
			this.trails.add(this.vector, position, color);
			const ahead = this.color2.copy(color).multiplyScalar(0.3);
			const points = path.length / 4;
			if (position.segment + 1 < points) {
				this.vector.set(
					path[position.segment * 4 + 5]!,
					path[position.segment * 4 + 6]!,
					path[position.segment * 4 + 7]!
				);
				this.trails.add(position, this.vector, ahead);
			}
			for (let i = position.segment + 1; i + 1 < points; i++) {
				this.vector.set(path[i * 4 + 1]!, path[i * 4 + 2]!, path[i * 4 + 3]!);
				this.vector2.set(path[i * 4 + 5]!, path[i * 4 + 6]!, path[i * 4 + 7]!);
				this.trails.add(this.vector, this.vector2, ahead);
			}

			if (count < this.grenadeHeads.instanceMatrix.count) {
				this.matrix.makeTranslation(position.x, position.y, position.z);
				this.grenadeHeads.setMatrixAt(count, this.matrix);
				this.grenadeHeads.setColorAt(count, color);
				count++;
			}
		}
		this.trails.end();
		this.grenadeHeads.count = count;
		this.grenadeHeads.instanceMatrix.needsUpdate = true;
		if (this.grenadeHeads.instanceColor) this.grenadeHeads.instanceColor.needsUpdate = true;
	}

	private updateEffects(replay: RoundReplay, tick: number) {
		const { meta } = replay;
		this.smokes.begin();
		this.fires.begin();
		this.blasts.begin();
		this.rings.begin();

		for (const effect of this.simpleEffects ? meta.effects : []) {
			if (tick < effect.startTick || tick > effect.endTick) continue;
			const age = (tick - effect.startTick) / meta.tickRate;
			const left = (effect.endTick - tick) / meta.tickRate;

			if (effect.type === 'smoke') {
				const fade = Math.min(1, age / 0.8, left / 1.5);
				const grow = Math.min(1, 0.35 + age * 0.9);
				const mesh = this.smokes.next<THREE.MeshLambertMaterial>();
				mesh.position.set(effect.x, effect.y, effect.z + 48 * grow);
				mesh.scale.set(SMOKE_RADIUS * grow, SMOKE_RADIUS * grow, 112 * grow);
				mesh.material.opacity = 0.82 * fade;
			} else if (effect.type === 'molotov') {
				const fade = Math.min(1, age / 0.4, left / 0.8);
				const flicker = 0.85 + 0.15 * Math.sin(tick * 0.9 + effect.x);
				const mesh = this.fires.next();
				mesh.position.set(effect.x, effect.y, effect.z + 3);
				mesh.scale.setScalar(FIRE_RADIUS * Math.min(1, 0.4 + age));
				mesh.material.opacity = 0.55 * fade * flicker;
			} else if (effect.type === 'flash' || effect.type === 'he') {
				const duration = Math.max(0.05, (effect.endTick - effect.startTick) / meta.tickRate);
				const progress = Math.min(1, age / duration);
				const mesh = this.blasts.next();
				mesh.position.set(effect.x, effect.y, effect.z);
				mesh.scale.setScalar((effect.type === 'flash' ? 70 : 200) * (0.3 + progress));
				mesh.material.color.setHex(effect.type === 'flash' ? 0xffffff : 0xff6a3d);
				mesh.material.opacity = (effect.type === 'flash' ? 0.9 : 0.55) * (1 - progress);
			} else if (effect.type === 'decoy') {
				const mesh = this.rings.next();
				mesh.position.set(effect.x, effect.y, effect.z + 2);
				mesh.scale.setScalar(18 + 6 * Math.sin(age * 8));
				mesh.material.color.setHex(0x9aa4ae);
				mesh.material.opacity = 0.7;
			}
		}

		const bomb = bombState(replay, tick);
		if (bomb?.kind === 'planted') {
			const seconds = (tick - bomb.tick) / meta.tickRate;
			const pulse = 0.5 + 0.5 * Math.sin(seconds * Math.PI * 2);
			const mesh = this.rings.next();
			mesh.position.set(bomb.x, bomb.y, bomb.z + 2);
			mesh.scale.setScalar(26 + 18 * pulse);
			mesh.material.color.setHex(0xff4646);
			mesh.material.opacity = 0.4 + 0.5 * pulse;
		}

		this.smokes.end();
		this.fires.end();
		this.blasts.end();
		this.rings.end();
	}

	private updateBomb(replay: RoundReplay, tick: number) {
		const bomb = bombState(replay, tick);
		this.bomb.visible = Boolean(bomb && bomb.kind !== 'exploded');
		if (!bomb) return;
		this.bomb.position.set(bomb.x, bomb.y, bomb.z + 3);
		(this.bomb.material as THREE.MeshLambertMaterial).color.setHex(
			bomb.kind === 'defused' ? 0x4cc38a : 0xef4b4b
		);
	}

	private updateSteps(replay: RoundReplay, tick: number, pov: number | null) {
		const { meta } = replay;
		this.steps.begin();
		for (const step of this.footsteps ? recentFootsteps(replay, tick, STEP_SECONDS) : []) {
			const player = meta.players[step.player];
			if (!player || step.player === pov) continue;
			const age = (tick - step.tick) / meta.tickRate / STEP_SECONDS;
			const mesh = this.steps.next();
			mesh.position.set(step.x, step.y, step.z + 3);
			mesh.scale.setScalar(STEP_RADIUS * (0.25 + 0.75 * age));
			mesh.material.color.setHex(sideColors[player.side]);
			mesh.material.opacity = 0.55 * (1 - age);
		}
		this.steps.end();
	}

	private updateShots(
		replay: RoundReplay,
		tick: number,
		players: PlayerState[],
		pov: number | null
	) {
		const shots = this.simpleEffects ? replay.meta.shots : [];
		this.shots.begin();
		for (let i = 0; i < shots.length; i += 2) {
			const shotTick = shots[i]!;
			if (shotTick > tick || shotTick < tick - SHOT_TICKS) continue;
			const index = shots[i + 1]!;
			const shooter = players[index];
			if (!shooter?.alive || index === pov) continue;
			const fade = 1 - (tick - shotTick) / SHOT_TICKS;
			this.vector.set(shooter.x, shooter.y, shooter.z + eyeHeight(shooter));
			aimDirection(shooter, this.vector2).multiplyScalar(SHOT_LENGTH).add(this.vector);
			this.shotColor.setHex(0xfff4c8).multiplyScalar(fade);
			this.shots.add(this.vector, this.vector2, this.shotColor, 0);
		}
		this.shots.end();
	}

	dispose() {
		this.bodyGeometry.dispose();
		this.noseGeometry.dispose();
		this.torsoGeometry.dispose();
		this.skullGeometry.dispose();
		this.legGeometry.dispose();
		this.aimGeometry.dispose();
		this.sphere.dispose();
		this.disc.dispose();
		this.ring.dispose();
		this.stepRing.dispose();
		for (const actor of this.players) {
			actor.body.material.dispose();
			actor.ghost.material.dispose();
			actor.marker.material.dispose();
			(actor.aim.material as THREE.Material).dispose();
		}
		((this.bomb.children[0] as THREE.Mesh).material as THREE.Material).dispose();
		for (const mesh of [this.deaths, this.grenadeHeads, this.bomb]) {
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
		}
		this.deaths.dispose();
		this.grenadeHeads.dispose();
		this.trails.dispose();
		this.shots.dispose();
		this.path.dispose();
		(this.path.object.material as THREE.Material).dispose();
		(this.trails.object.material as THREE.Material).dispose();
		(this.shots.object.material as THREE.Material).dispose();
		for (const pool of [this.smokes, this.fires, this.blasts, this.rings, this.steps]) pool.dispose();
	}
}
