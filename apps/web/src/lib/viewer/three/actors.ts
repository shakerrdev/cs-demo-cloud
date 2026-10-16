import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type {
	GrenadeType,
	ReplayKill,
	ReplayPlayer,
	RoundReplay,
	Side
} from '@cs-demo-cloud/replay';
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
const DEG = Math.PI / 180;

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
	body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
	ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	head: THREE.Group;
	nose: THREE.Mesh;
	aim: THREE.Line;
	marker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	side: Side;
}

export class Actors {
	readonly root = new THREE.Group();
	private bodyGeometry = new THREE.CapsuleGeometry(16, STAND_HEIGHT - 32, 4, 12);
	private noseGeometry = new THREE.ConeGeometry(6, 22, 12);
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
	private shots = new Lines(
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
		0.3
	);
	private sphere = new THREE.SphereGeometry(1, 24, 16);
	private disc = new THREE.CircleGeometry(1, 40);
	private ring = new THREE.RingGeometry(0.82, 1, 48);
	private smokes: Pool;
	private fires: Pool;
	private blasts: Pool;
	private rings: Pool;
	private bomb: THREE.Mesh;
	private color = new THREE.Color();
	private shotColor = new THREE.Color();
	private matrix = new THREE.Matrix4();
	private vector = new THREE.Vector3();
	private vector2 = new THREE.Vector3();
	private capsules = true;
	private simpleEffects = true;

	constructor() {
		this.bodyGeometry.rotateX(Math.PI / 2);
		this.bodyGeometry.translate(0, 0, STAND_HEIGHT / 2);
		this.noseGeometry.rotateZ(-Math.PI / 2);
		this.noseGeometry.translate(20, 0, 0);

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

		this.root.add(this.deaths, this.grenadeHeads, this.trails.object, this.shots.object, this.bomb);
	}

	setPlayers(players: ReplayPlayer[]) {
		while (this.players.length < players.length) this.players.push(this.createPlayer());
		this.players.forEach((actor, i) => {
			const player = players[i];
			actor.group.visible = false;
			if (!player) return;
			actor.side = player.side;
			actor.body.material.color.setHex(sideColors[player.side]);
			actor.ghost.material.color.setHex(sideColors[player.side]);
			actor.marker.material.color.setHex(sideColors[player.side]);
			(actor.aim.material as THREE.LineBasicMaterial).color.setHex(sideColors[player.side]);
		});
	}

	setCapsules(visible: boolean) {
		this.capsules = visible;
	}

	setSimpleEffects(visible: boolean) {
		this.simpleEffects = visible;
	}

	bodies(): THREE.Object3D[] {
		return this.players.filter((actor) => actor.group.visible).map((actor) => actor.body);
	}

	indexOf(object: THREE.Object3D): number {
		return this.players.findIndex((actor) => actor.body === object);
	}

	update(
		replay: RoundReplay,
		tick: number,
		players: PlayerState[],
		focus: number | null,
		pov: number | null,
		sizeOf: (player: PlayerState) => number
	) {
		this.updatePlayers(players, focus, pov, sizeOf);
		this.updateDeaths(replay.meta.kills, replay.meta.players, tick);
		this.updateGrenades(replay, tick);
		this.updateEffects(replay, tick);
		this.updateBomb(replay, tick);
		this.grenadeHeads.visible = this.simpleEffects;
		if (!this.simpleEffects) this.bomb.visible = false;
		this.updateShots(replay, tick, players, pov);
	}

	private createPlayer(): PlayerActor {
		const group = new THREE.Group();
		const body = new THREE.Mesh(
			this.bodyGeometry,
			new THREE.MeshLambertMaterial({ color: 0xffffff })
		);
		const ghost = new THREE.Mesh(
			this.bodyGeometry,
			hiddenPart(new THREE.MeshBasicMaterial({ opacity: 0.32 })) as THREE.MeshBasicMaterial
		);
		ghost.renderOrder = 3;
		const head = new THREE.Group();
		const nose = new THREE.Mesh(this.noseGeometry, body.material);
		const aim = new THREE.Line(
			this.aimGeometry,
			new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 })
		);
		head.add(nose, aim);
		const marker = new THREE.Mesh(
			this.ring,
			new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, side: THREE.DoubleSide })
		);
		marker.position.z = 2;
		marker.scale.setScalar(28);
		group.add(body, ghost, head, marker);
		group.visible = false;
		this.root.add(group);
		return { group, body, ghost, head, nose, aim, marker, side: 'CT' };
	}

	private updatePlayers(
		players: PlayerState[],
		focus: number | null,
		pov: number | null,
		sizeOf: (player: PlayerState) => number
	) {
		players.forEach((player, i) => {
			const actor = this.players[i];
			if (!actor) return;
			const visible = player.alive && player.present && i !== pov;
			actor.group.visible = visible;
			if (!visible) return;

			actor.group.position.set(player.x, player.y, player.z);
			actor.group.rotation.set(0, 0, player.yaw * DEG);
			actor.group.scale.setScalar(sizeOf(player));
			const crouch = player.ducking ? CROUCH_HEIGHT / STAND_HEIGHT : 1;
			actor.body.scale.set(1, 1, crouch);
			actor.ghost.scale.set(1, 1, crouch);
			actor.head.position.set(0, 0, eyeHeight(player));
			actor.head.rotation.set(0, player.pitch * DEG, 0);
			actor.body.visible = this.capsules;
			actor.ghost.visible = this.capsules;
			actor.nose.visible = this.capsules;
			actor.aim.visible = i === focus;
			actor.marker.visible = i === focus;
			actor.body.material.emissive.setScalar(player.blind * 0.8);
		});
	}

	private updateDeaths(kills: ReplayKill[], players: ReplayPlayer[], tick: number) {
		let count = 0;
		for (const kill of this.capsules ? kills : []) {
			if (kill.tick > tick || count >= this.deaths.instanceMatrix.count) continue;
			const victim = players[kill.victim];
			if (!victim) continue;
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
		this.aimGeometry.dispose();
		this.sphere.dispose();
		this.disc.dispose();
		this.ring.dispose();
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
		(this.trails.object.material as THREE.Material).dispose();
		(this.shots.object.material as THREE.Material).dispose();
		for (const pool of [this.smokes, this.fires, this.blasts, this.rings]) pool.dispose();
	}
}
