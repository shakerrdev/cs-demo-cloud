import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { FLAG_PRESENT, type MapInfo, type MapMesh, type RoundReplay } from '@cs-demo-cloud/replay';
import type { Listener } from '../audio.ts';
import { playerMotion, playerStates, viewState, type PlayerState } from '../frame.ts';
import { Actors, aimDirection, eyeHeight, sideColors } from './actors.ts';
import { applyRadar, createMapGeometry, createMapMaterial, placeMap, radarTexture } from './map.ts';
import type { MapPack, PackProgress, TextureQuality } from './cs2/pack.ts';
import type { GameEffects } from './cs2/effects.ts';
import type { PlayerModels } from './cs2/players.ts';
import type { PovPose, Viewmodel } from './cs2/viewmodel.ts';

export type { TextureQuality };

export type CameraMode = 'free' | 'follow' | 'pov';

export type PackStatus =
	| { state: 'none' }
	| { state: 'loading'; progress: PackProgress | null }
	| { state: 'ready'; progress: PackProgress }
	| { state: 'error'; message: string };

export interface SceneFrame {
	replay: RoundReplay;
	tick: number;
	focus: number | null;
	mode: CameraMode;
	roofs: boolean;
}

const background = new THREE.Color(0x0b0d10);
const POV_FOV = 74;
const ORBIT_FOV = 50;
const ROOF_CUT = 170;
const MAX_PLAYER_SCALE = 3;
const LISTENER_RANGE = 500;
const VIEW_RECOIL = 0.9;
const STAND_EYE = 64;
const CROUCH_EYE = 46;
const DEG = Math.PI / 180;

export class ReplayScene {
	onPick: ((index: number) => void) | null = null;
	onPackStatus: ((status: PackStatus) => void) | null = null;

	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 6, 60000);
	private controls: MapControls;
	private overlay: CanvasRenderingContext2D;
	private actors = new Actors();
	private mapMaterial = createMapMaterial(background);
	private mapObject: THREE.Mesh | null = null;
	private textures: THREE.Texture[] = [];
	private map: MapInfo | null = null;
	private mesh: MapMesh | null = null;
	private width = 1;
	private height = 1;
	private pixelRatio = 1;
	private dirty = true;
	private lastKey = '';
	private framedMap: string | null = null;
	private round = -1;
	private mode: CameraMode = 'free';
	private orbit = { position: new THREE.Vector3(), target: new THREE.Vector3() };
	private followAnchor: THREE.Vector3 | null = null;
	private players: PlayerState[] = [];
	private pov: number | null = null;
	private povPose: PovPose | null = null;
	private pointer = { x: 0, y: 0, down: false };
	private raycaster = new THREE.Raycaster();
	private projected = new THREE.Vector3();
	private detach: () => void;
	private pack: MapPack | null = null;
	private packKey = '';
	private models: PlayerModels | null = null;
	private effects: GameEffects | null = null;
	private replay: RoundReplay | null = null;
	private muzzleFallback = new THREE.Vector3();
	private modelsKey = '';
	private started = performance.now();

	constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			powerPreference: 'high-performance'
		});
		this.renderer.setClearColor(background);
		const context = overlay.getContext('2d');
		if (!context) throw new Error('2D canvas is not available');
		this.overlay = context;

		this.camera.up.set(0, 0, 1);
		this.camera.position.set(0, -3000, 4000);
		this.controls = new MapControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.14;
		this.controls.zoomToCursor = true;
		this.controls.minDistance = 60;
		this.controls.maxDistance = 16000;
		this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
		this.controls.addEventListener('change', this.markDirty);

		this.scene.background = background;
		this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x3b3631, 2.1));
		const sun = new THREE.DirectionalLight(0xffffff, 1.7);
		sun.position.set(0.45, 0.3, 1);
		this.scene.add(sun, this.actors.root);

		const down = (event: PointerEvent) => {
			this.pointer = { x: event.clientX, y: event.clientY, down: true };
		};
		const up = (event: PointerEvent) => {
			const moved = Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y);
			if (this.pointer.down && moved < 5 && event.button === 0) this.pick(event);
			this.pointer.down = false;
		};
		canvas.addEventListener('pointerdown', down);
		canvas.addEventListener('pointerup', up);
		if (import.meta.env.DEV) (window as unknown as { replayScene: ReplayScene }).replayScene = this;
		this.detach = () => {
			canvas.removeEventListener('pointerdown', down);
			canvas.removeEventListener('pointerup', up);
		};
	}

	setSize(width: number, height: number, pixelRatio: number) {
		if (width === this.width && height === this.height && pixelRatio === this.pixelRatio) return;
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		this.pixelRatio = pixelRatio;
		this.renderer.setPixelRatio(pixelRatio);
		this.renderer.setSize(this.width, this.height, false);
		this.pack?.post.setSize(
			Math.round(this.width * pixelRatio),
			Math.round(this.height * pixelRatio)
		);
		this.overlay.canvas.width = Math.round(this.width * pixelRatio);
		this.overlay.canvas.height = Math.round(this.height * pixelRatio);
		this.camera.aspect = this.width / this.height;
		this.camera.updateProjectionMatrix();
		this.dirty = true;
	}

	setMap(
		map: MapInfo | null,
		mesh: MapMesh | null,
		radars: { upper: HTMLImageElement | null; lower: HTMLImageElement | null }
	) {
		if (this.mesh !== mesh) {
			if (this.mapObject) {
				this.scene.remove(this.mapObject);
				this.mapObject.geometry.dispose();
				this.mapObject = null;
			}
			if (mesh) {
				this.mapObject = new THREE.Mesh(createMapGeometry(mesh), this.mapMaterial);
				this.mapObject.frustumCulled = false;
				this.mapObject.visible = !this.pack;
				placeMap(this.mapObject, mesh);
				this.scene.add(this.mapObject);
			}
			this.mesh = mesh;
		}

		for (const texture of this.textures) texture.dispose();
		const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
		const upper = radarTexture(radars.upper, anisotropy);
		const lower = radarTexture(radars.lower, anisotropy);
		this.textures = [upper, lower].filter((t): t is THREE.Texture => t !== null);
		applyRadar(this.mapMaterial, map, upper, lower);

		if (this.map?.name !== map?.name) this.framedMap = null;
		this.map = map;
		this.dirty = true;
	}

	setPack(map: string, version: string | null, quality: TextureQuality = 'auto') {
		const key = version ? `${map}@${version}@${quality}` : '';
		if (key === this.packKey) return;
		this.packKey = key;
		this.clearPack();
		if (!version) {
			this.onPackStatus?.({ state: 'none' });
			return;
		}
		this.onPackStatus?.({ state: 'loading', progress: null });
		import('./cs2/pack.ts')
			.then(({ MapPack }) =>
				MapPack.load(
					this.renderer,
					map,
					version,
					(progress) => {
						if (this.packKey !== key) return;
						this.onPackStatus?.(
							progress.ready ? { state: 'ready', progress } : { state: 'loading', progress }
						);
					},
					quality
				)
			)
			.then(async (pack) => {
				if (this.packKey !== key) {
					pack.dispose();
					return;
				}
				await this.compile(pack.main, pack.post.target);
				if (this.packKey !== key) {
					pack.dispose();
					return;
				}
				this.pack = pack;
				pack.onChange = this.markDirty;
				pack.post.setSize(
					Math.round(this.width * this.pixelRatio),
					Math.round(this.height * this.pixelRatio)
				);
				this.scene.add(pack.main);
				if (this.mapObject) this.mapObject.visible = false;
				this.models?.setShading(pack.characterShading);
				void import('./cs2/effects.ts').then(({ GameEffects }) => {
					if (this.pack !== pack) return;
					this.effects = new GameEffects();
					this.effects.setShading(pack.characterShading);
					this.scene.add(this.effects.root);
					this.actors.setSimpleEffects(false);
					this.dirty = true;
				});
				this.dirty = true;
			})
			.catch((error: Error) => {
				if (this.packKey !== key) return;
				console.warn(error);
				this.onPackStatus?.({ state: 'error', message: error.message });
			});
	}

	setPlayerPack(
		version: string | null,
		quality: TextureQuality = 'auto',
		skins: string | null = null
	) {
		const key = version ? `${version}@${quality}@${skins ?? ''}` : '';
		if (key === this.modelsKey) return;
		this.modelsKey = key;
		this.clearModels();
		if (!version) return;
		import('./cs2/players.ts')
			.then(async ({ PlayerModels, PlayerPack }) => {
				const pack = await PlayerPack.load(this.renderer, version, quality, skins);
				if (this.modelsKey !== key) {
					pack.dispose();
					return;
				}
				pack.onChange = this.markDirty;
				const models = new PlayerModels(pack);
				this.models = models;
				models.onChange = this.markDirty;
				if (models.viewmodel) models.viewmodel.onChange = this.markDirty;
				models.setShading(this.pack?.characterShading ?? null);
				this.scene.add(models.root);
				this.round = -1;
				this.dirty = true;
			})
			.catch((error: Error) => {
				if (this.modelsKey === key) console.warn(error);
			});
	}

	private async compile(object: THREE.Object3D, target: THREE.WebGLRenderTarget | null) {
		const previous = this.renderer.getRenderTarget();
		this.renderer.setRenderTarget(target);
		const done = this.renderer.compileAsync(object, this.camera, this.scene);
		this.renderer.setRenderTarget(previous);
		try {
			await done;
		} catch (error) {
			console.warn(error);
		}
	}

	private clearModels() {
		if (!this.models) return;
		this.scene.remove(this.models.root);
		this.models.dispose();
		this.models = null;
		this.actors.setCapsules(true);
		this.dirty = true;
	}

	private clearPack() {
		this.models?.setShading(null);
		if (this.effects) {
			this.scene.remove(this.effects.root);
			this.effects.dispose();
			this.effects = null;
			this.actors.setSimpleEffects(true);
		}
		if (!this.pack) return;
		this.scene.remove(this.pack.main);
		this.pack.dispose();
		this.pack = null;
		if (this.mapObject) this.mapObject.visible = true;
		this.dirty = true;
	}

	listener(focus: number | null): Listener {
		const e = this.camera.matrixWorld.elements;
		const focused = focus !== null ? this.players[focus] : undefined;
		const p =
			this.mode !== 'free' && focused?.alive
				? this.projected.set(focused.x, focused.y, focused.z + eyeHeight(focused))
				: this.camera.position.distanceTo(this.controls.target) > LISTENER_RANGE
					? this.projected
							.copy(this.camera.position)
							.sub(this.controls.target)
							.setLength(LISTENER_RANGE)
							.add(this.controls.target)
					: this.camera.position;
		return {
			position: [p.x, p.y, p.z],
			forward: [-e[8]!, -e[9]!, -e[10]!],
			up: [e[4]!, e[5]!, e[6]!]
		};
	}

	resetView() {
		this.framedMap = null;
		this.dirty = true;
	}

	render(frame: SceneFrame) {
		const { replay, tick, focus, mode, roofs } = frame;
		this.replay = replay;
		if (replay.meta.round !== this.round) {
			this.round = replay.meta.round;
			this.actors.setPlayers(replay.meta.players);
			this.models?.setPlayers(replay.meta.players, sideColors);
			this.updateHeightRange(replay);
			this.dirty = true;
		}
		if (this.framedMap !== (this.map?.name ?? '')) this.frame(replay);
		if (mode !== this.mode) this.switchMode(mode);

		const key = `${tick}|${focus}|${mode}|${roofs}|${this.round}`;
		if (key !== this.lastKey) {
			this.lastKey = key;
			this.dirty = true;
		}
		if (this.controls.enabled) this.controls.update();
		if (!this.dirty) return;
		this.dirty = false;

		this.players = playerStates(replay, tick);
		const focused = focus !== null ? this.players[focus] : undefined;
		this.pov = mode === 'pov' && focused?.alive ? focus : null;

		if (mode === 'follow' && focused?.alive) this.follow(focused);
		else this.followAnchor = null;
		this.povPose = mode === 'pov' && focused ? this.placePov(replay, tick, focused) : null;

		const cutZ = roofs ? 1e9 : this.cutHeight(focused) + ROOF_CUT;
		this.mapMaterial.uniforms.uCutZ!.value = cutZ;
		this.pack?.setCutZ(cutZ);
		const models = this.models?.active ? this.models : null;
		this.actors.setCapsules(!models);
		this.actors.update(replay, tick, this.players, focus, this.pov, this.sizeOf);
		this.models?.update(replay, tick, this.players, this.pov, true);
		if (this.effects) this.models?.updateProps(replay, tick);
		this.camera.updateMatrixWorld();
		const viewmodel =
			this.pov !== null
				? (this.models?.updateViewmodel(
						replay,
						tick,
						this.players[this.pov] ?? null,
						this.camera,
						this.povPose
					) ?? null)
				: null;
		this.effects?.update(
			replay,
			tick,
			this.players,
			this.camera,
			(index, target) => {
				const player = this.players[index];
				if (!player || index === this.pov) return null;
				return (
					this.models?.muzzle(player, target) ??
					target
						.set(player.x, player.y, player.z + eyeHeight(player) - 6)
						.add(aimDirection(player, this.muzzleFallback).multiplyScalar(28))
				);
			},
			(performance.now() - this.started) / 1000
		);
		if (this.pack) this.renderPack(this.pack, viewmodel);
		else this.renderer.render(this.scene, this.camera);
		this.drawOverlay(focus);
	}

	private renderPack(pack: MapPack, viewmodel: Viewmodel | null) {
		const renderer = this.renderer;
		this.camera.updateMatrixWorld();
		pack.update(this.camera, (performance.now() - this.started) / 1000);
		const background = this.scene.background;
		this.scene.background = null;
		renderer.autoClear = false;
		renderer.setRenderTarget(pack.post.target);
		renderer.setClearColor(0x000000, 1);
		renderer.clear(true, true, true);
		if (pack.skyboxScene) {
			renderer.render(pack.skyboxScene, pack.skyboxCamera);
			renderer.clearDepth();
		}
		renderer.render(this.scene, this.camera);
		if (viewmodel) {
			renderer.clearDepth();
			renderer.render(viewmodel.scene, viewmodel.camera);
		}
		pack.post.render(renderer);
		renderer.autoClear = true;
		renderer.setClearColor(background as THREE.Color);
		this.scene.background = background;
	}

	dispose() {
		this.packKey = '';
		this.modelsKey = '';
		this.clearModels();
		this.clearPack();
		this.detach();
		this.controls.removeEventListener('change', this.markDirty);
		this.controls.dispose();
		this.actors.dispose();
		this.mapObject?.geometry.dispose();
		this.mapMaterial.dispose();
		for (const texture of this.textures) texture.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}

	private markDirty = () => {
		this.dirty = true;
	};

	private sizeOf = (player: PlayerState): number => {
		if (this.mode === 'pov' || this.models?.active) return 1;
		const distance = this.projected
			.set(player.x, player.y, player.z)
			.distanceTo(this.camera.position);
		return Math.min(MAX_PLAYER_SCALE, Math.max(1, distance / 1600));
	};

	private frame(replay: RoundReplay) {
		const z = startHeight(replay);
		const map = this.map;
		let center: THREE.Vector3;
		let extent: number;
		if (map) {
			extent = map.scale * 1024;
			center = new THREE.Vector3(map.posX + extent / 2, map.posY - extent / 2, z);
		} else if (this.mesh) {
			const [x0, y0] = this.mesh.min;
			const [x1, y1] = this.mesh.max;
			extent = Math.max(x1 - x0, y1 - y0);
			center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, z);
		} else {
			extent = 4000;
			center = new THREE.Vector3(0, 0, z);
		}
		this.controls.target.copy(center);
		this.camera.position.set(center.x, center.y - extent * 0.55, center.z + extent * 0.85);
		this.mapMaterial.uniforms.uFogDensity!.value = 0.55 / (extent * 2.2);
		if (this.mode === 'pov') this.mode = 'free';
		this.followAnchor = null;
		this.controls.enabled = true;
		this.camera.fov = ORBIT_FOV;
		this.camera.updateProjectionMatrix();
		this.controls.update();
		this.framedMap = map?.name ?? '';
		this.dirty = true;
	}

	private switchMode(mode: CameraMode) {
		if (mode === 'pov') {
			this.orbit.position.copy(this.camera.position);
			this.orbit.target.copy(this.controls.target);
			this.controls.enabled = false;
			this.camera.fov = POV_FOV;
		} else if (this.mode === 'pov') {
			this.camera.position.copy(this.orbit.position);
			this.controls.target.copy(this.orbit.target);
			this.controls.enabled = true;
			this.camera.fov = ORBIT_FOV;
			this.controls.update();
		}
		this.camera.updateProjectionMatrix();
		this.followAnchor = null;
		this.mode = mode;
		this.dirty = true;
	}

	private follow(player: PlayerState) {
		const anchor = new THREE.Vector3(player.x, player.y, player.z + 40);
		if (!this.followAnchor) {
			const offset = this.camera.position.clone().sub(this.controls.target);
			if (offset.length() > 2400) offset.setLength(1400);
			this.controls.target.copy(anchor);
			this.camera.position.copy(anchor).add(offset);
		} else {
			const delta = anchor.clone().sub(this.followAnchor);
			this.controls.target.add(delta);
			this.camera.position.add(delta);
		}
		this.followAnchor = anchor;
		this.controls.update();
	}

	private placePov(replay: RoundReplay, tick: number, player: PlayerState): PovPose {
		const view = viewState(replay, player.index, tick);
		const before = view ? viewState(replay, player.index, tick - replay.meta.tickRate / 16) : null;
		const yaw = (view?.yaw ?? player.yaw) + (view?.punchYaw ?? 0) * VIEW_RECOIL;
		const pitch = (view?.pitch ?? player.pitch) + (view?.punchPitch ?? 0) * VIEW_RECOIL;
		const eye = view ? STAND_EYE + (CROUCH_EYE - STAND_EYE) * view.duck : eyeHeight(player);
		this.camera.position.set(view?.x ?? player.x, view?.y ?? player.y, (view?.z ?? player.z) + eye);
		const look = new THREE.Vector3(
			Math.cos(pitch * DEG) * Math.cos(yaw * DEG),
			Math.cos(pitch * DEG) * Math.sin(yaw * DEG),
			-Math.sin(pitch * DEG)
		).add(this.camera.position);
		this.camera.lookAt(look);
		const motion = playerMotion(replay, player.index, tick);
		const turn = view && before ? ((((view.yaw - before.yaw) % 360) + 540) % 360) - 180 : 0;
		return { yaw, pitch, speed: motion.speed, distance: motion.distance, turn: turn * 16 };
	}

	private cutHeight(focused: PlayerState | undefined): number {
		if (focused?.alive) return focused.z;
		const heights = this.players.filter((p) => p.alive && p.present).map((p) => p.z);
		return heights.length ? median(heights) : this.controls.target.z;
	}

	private updateHeightRange(replay: RoundReplay) {
		const z = startHeight(replay);
		(this.mapMaterial.uniforms.uHeightRange!.value as THREE.Vector2).set(z - 250, z + 450);
	}

	private pick(event: PointerEvent) {
		if (!this.onPick) return;
		const rect = this.renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1
		);
		this.raycaster.setFromCamera(ndc, this.camera);
		const [hit] = this.raycaster.intersectObjects(this.actors.bodies(), false);
		if (!hit) return;
		const index = this.actors.indexOf(hit.object);
		if (index >= 0) this.onPick(index);
	}

	private drawOverlay(focus: number | null) {
		const ctx = this.overlay;
		const ratio = this.pixelRatio;
		const width = ctx.canvas.width;
		const height = ctx.canvas.height;
		ctx.clearRect(0, 0, width, height);

		if (this.pov !== null) {
			const cx = width / 2;
			const cy = height / 2;
			const arm = 7 * ratio;
			ctx.strokeStyle = 'rgba(120, 255, 140, 0.9)';
			ctx.lineWidth = 2 * ratio;
			ctx.beginPath();
			ctx.moveTo(cx - arm * 2, cy);
			ctx.lineTo(cx - arm, cy);
			ctx.moveTo(cx + arm, cy);
			ctx.lineTo(cx + arm * 2, cy);
			ctx.moveTo(cx, cy - arm * 2);
			ctx.lineTo(cx, cy - arm);
			ctx.moveTo(cx, cy + arm);
			ctx.lineTo(cx, cy + arm * 2);
			ctx.stroke();
		}

		const fontSize = Math.round(11.5 * ratio);
		ctx.font = `600 ${fontSize}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'bottom';

		const labels = this.players
			.filter((p) => p.alive && p.present && p.index !== this.pov)
			.map((player) => {
				const lift = (player.ducking ? 66 : 84) * this.sizeOf(player);
				this.projected.set(player.x, player.y, player.z + lift).project(this.camera);
				return { player, ndc: this.projected.clone() };
			})
			.filter(
				({ ndc }) => ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2
			)
			.sort((a, b) => b.ndc.z - a.ndc.z);

		for (const { player, ndc } of labels) {
			const x = ((ndc.x + 1) / 2) * width;
			const y = ((1 - ndc.y) / 2) * height;
			const focused = player.index === focus;
			const name = player.name.length > 14 ? `${player.name.slice(0, 13)}…` : player.name;
			const label = player.bomb ? `${name} · C4` : name;
			const barWidth = 34 * ratio;
			const barY = y - 2 * ratio;

			ctx.globalAlpha = focused ? 1 : 0.92;
			ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
			ctx.fillRect(x - barWidth / 2 - ratio, barY - ratio, barWidth + 2 * ratio, 5 * ratio);
			ctx.fillStyle = player.health > 30 ? '#4cc38a' : '#ef4b4b';
			ctx.fillRect(x - barWidth / 2, barY, (barWidth * player.health) / 100, 3 * ratio);

			ctx.lineWidth = 3 * ratio;
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
			ctx.strokeText(label, x, barY - 3 * ratio);
			ctx.fillStyle = focused ? '#ffffff' : player.side === 'CT' ? '#bfe0f7' : '#f6dca8';
			ctx.fillText(label, x, barY - 3 * ratio);
		}
		ctx.globalAlpha = 1;
	}
}

function startHeight(replay: RoundReplay): number {
	const { meta, columns } = replay;
	const heights: number[] = [];
	for (let p = 0; p < meta.players.length; p++) {
		const i = p * meta.frameCount;
		if (columns.flags[i]! & FLAG_PRESENT) heights.push(columns.z[i]!);
	}
	return heights.length ? median(heights) : 0;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)]!;
}
