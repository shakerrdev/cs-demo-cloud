import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import {
	FLAG_PRESENT,
	crosshairColor,
	decodeCrosshair,
	rgbaCss,
	defaultConfig,
	type Crosshair,
	horizontalToVerticalFov,
	type AppConfig,
	weaponKey,
	type MapInfo,
	type MapMesh,
	type RoundReplay,
	MeshRaycaster,
	lerpAngle
} from '@cs-demo-cloud/replay';
import type { Listener } from '../audio.ts';
import { profiler } from '../perf.ts';
import {
	defaultDebug,
	defaultGraphics,
	type DebugToggles,
	type GraphicsSettings
} from '../graphics.ts';
import { playerMotion, playerStates, viewState, type PlayerState } from '../frame.ts';
import { Actors, aimDirection, eyeHeight, sideColors } from './actors.ts';
import {
	SUN_DIRECTION,
	applyRadar,
	applyShadow,
	createMapGeometry,
	createMapMaterial,
	placeMap,
	radarTexture
} from './map.ts';
import { bakeSunShadow, type SunShadow } from './sun-shadow.ts';
import type { MapPack, PackProgress, TextureQuality } from './cs2/pack.ts';
import type { GameEffects } from './cs2/effects.ts';
import type { PlayerModels } from './cs2/players.ts';
import type { PovPose, Viewmodel } from './cs2/viewmodel.ts';

export type { TextureQuality, DebugToggles, GraphicsSettings };

const GLIDE_SECONDS = 0.7;

export type CameraMode = 'free' | 'follow' | 'chase' | 'pov';

const MIN_AUTO_SCALE = 0.5;

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
	xray?: boolean;
}

const background = new THREE.Color(0x0b0d10);
const ORBIT_FOV = 50;
const CHASE_FOV = 68;
const CHASE_DISTANCE = 140;
const CHASE_MIN = 24;
const CHASE_CLEARANCE = 10;
const CHASE_FOLLOW = 6;
const SLOT_COLORS = ['#7fbdff', '#6fe08a', '#ffe066', '#ffa358', '#c99bff'];
const ROOF_CUT = 170;
const MAX_PLAYER_SCALE = 3;
const LISTENER_RANGE = 500;
const STAND_EYE = 64;
const CROUCH_EYE = 46;
const DEG = Math.PI / 180;
const ZOOM_FOVS: Record<string, [number, number]> = {
	awp: [40, 10],
	ssg08: [40, 15],
	scar20: [40, 15],
	g3sg1: [40, 15],
	aug: [45, 45],
	sg556: [45, 45]
};
const SNIPERS = new Set(['awp', 'ssg08', 'scar20', 'g3sg1']);

function verticalFov(horizontal43: number): number {
	return (2 * Math.atan(Math.tan((horizontal43 * DEG) / 2) * 0.75)) / DEG;
}

export function scopeOf(player: PlayerState | undefined): { fov: number; sniper: boolean } | null {
	if (!player?.alive || !player.scoped) return null;
	const key = weaponKey(player.weapon);
	const fovs = key ? ZOOM_FOVS[key] : undefined;
	if (!fovs || !key) return null;
	const level = Math.max(1, Math.min(2, player.zoom || 1));
	return { fov: verticalFov(fovs[level - 1]!), sniper: SNIPERS.has(key) };
}

const FLY_SPEED = 900;
const LOOK_SPEED = 0.004;
const FLY_KEYS = new Set([
	'KeyW',
	'KeyA',
	'KeyS',
	'KeyD',
	'KeyQ',
	'KeyE',
	'ShiftLeft',
	'ShiftRight'
]);

const SHADOW_SIZE = 4096;
export class ReplayScene {
	onPick: ((index: number) => void) | null = null;
	onCycle: ((direction: 1 | -1) => void) | null = null;
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
	private scope: { fov: number; sniper: boolean } | null = null;
	private blind = 0;
	private xray = true;
	private config: AppConfig = defaultConfig;
	private hurt = 0;
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
	private graphics: GraphicsSettings = defaultGraphics;
	syncTiming = false;
	private syncPixel = new Uint8Array(4);
	private scale = 1;
	private autoScale = new AutoScale();
	debug: DebugToggles = { ...defaultDebug };
	private overlayDirty = true;
	private crosshairs = new Map<string, Crosshair | null>();
	private flyKeys = new Set<string>();
	private sunShadow: SunShadow | null = null;
	private raycaster3: MeshRaycaster | null = null;
	private raycasterMesh: MapMesh | null = null;
	private transition: {
		position: THREE.Vector3;
		quaternion: THREE.Quaternion;
		start: number;
	} | null = null;
	private transitionFocus: number | null = null;
	private tick = 0;
	private shown = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
	private desired = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
	private chaseYaw: number | null = null;
	private chasePitch = 0;
	private chaseDistance = CHASE_DISTANCE;
	private lastChase = 0;
	private lastFly = 0;
	private viewmodelKey = '';

	constructor(
		canvas: HTMLCanvasElement,
		overlay: HTMLCanvasElement,
		options: { antialias?: boolean } = {}
	) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: options.antialias ?? true,
			powerPreference: 'high-performance'
		});
		const info = this.renderer.info;
		profiler.attachGl(this.renderer.getContext() as WebGL2RenderingContext, () => ({
			draws: info.render.calls,
			triangles: info.render.triangles
		}));
		info.autoReset = false;
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
		this.controls.maxPolarAngle = Math.PI * 0.95;
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
			if (this.pointer.down && moved < 5) {
				if (this.mode !== 'free' && (event.button === 0 || event.button === 2))
					this.onCycle?.(event.button === 0 ? 1 : -1);
				else if (event.button === 0) this.pick(event);
			}
			this.pointer.down = false;
		};
		const menu = (event: MouseEvent) => event.preventDefault();
		let look: { x: number; y: number; id: number } | null = null;
		const lookStart = (event: PointerEvent) => {
			if (this.mode !== 'free' || event.button !== 2 || event.shiftKey) return;
			event.stopImmediatePropagation();
			look = { x: event.clientX, y: event.clientY, id: event.pointerId };
			canvas.setPointerCapture(event.pointerId);
		};
		const lookMove = (event: PointerEvent) => {
			if (!look || event.pointerId !== look.id) return;
			event.stopImmediatePropagation();
			this.lookAround(event.clientX - look.x, event.clientY - look.y);
			look.x = event.clientX;
			look.y = event.clientY;
		};
		const lookEnd = (event: PointerEvent) => {
			if (!look || event.pointerId !== look.id) return;
			event.stopImmediatePropagation();
			look = null;
			if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
		};
		canvas.addEventListener('pointerdown', lookStart, { capture: true });
		canvas.addEventListener('pointermove', lookMove, { capture: true });
		canvas.addEventListener('pointerup', lookEnd, { capture: true });
		const isTyping = (target: EventTarget | null) =>
			target instanceof HTMLElement &&
			(['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
		const keyDown = (event: KeyboardEvent) => {
			if (this.mode !== 'free' || !canvas.isConnected || isTyping(event.target)) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (FLY_KEYS.has(event.code)) {
				this.flyKeys.add(event.code);
				this.dirty = true;
			}
		};
		const keyUp = (event: KeyboardEvent) => this.flyKeys.delete(event.code);
		const blur = () => this.flyKeys.clear();
		window.addEventListener('keydown', keyDown);
		window.addEventListener('keyup', keyUp);
		window.addEventListener('blur', blur);
		canvas.addEventListener('pointerdown', down);
		canvas.addEventListener('pointerup', up);
		canvas.addEventListener('contextmenu', menu);
		if (import.meta.env.DEV || location.search.includes('perf'))
			(window as unknown as { replayScene: ReplayScene }).replayScene = this;
		this.detach = () => {
			canvas.removeEventListener('pointerdown', down);
			canvas.removeEventListener('pointerup', up);
			canvas.removeEventListener('contextmenu', menu);
			canvas.removeEventListener('pointerdown', lookStart, { capture: true });
			canvas.removeEventListener('pointermove', lookMove, { capture: true });
			canvas.removeEventListener('pointerup', lookEnd, { capture: true });
			window.removeEventListener('keydown', keyDown);
			window.removeEventListener('keyup', keyUp);
			window.removeEventListener('blur', blur);
		};
	}

	setSize(width: number, height: number, pixelRatio: number) {
		if (width === this.width && height === this.height && pixelRatio === this.pixelRatio) return;
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		this.pixelRatio = pixelRatio;
		this.overlay.canvas.width = Math.round(this.width * pixelRatio);
		this.overlay.canvas.height = Math.round(this.height * pixelRatio);
		this.overlayDirty = true;
		this.camera.aspect = this.width / this.height;
		this.camera.updateProjectionMatrix();
		this.autoScale.reset();
		this.applyScale();
	}

	setGraphics(graphics: GraphicsSettings) {
		this.graphics = graphics;
		this.pack?.post.setSamples(graphics.msaa);
		this.autoScale.reset();
		this.applyScale();
	}

	get renderScale(): number {
		return this.scale;
	}

	get drawingSize(): { width: number; height: number } {
		const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
		return { width: size.x, height: size.y };
	}

	get gpuName(): string {
		const gl = this.renderer.getContext();
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		return String(
			debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
		);
	}

	get packInfo() {
		if (!this.models) return null;
		const pov = this.pov !== null ? this.replay?.meta.players[this.pov] : undefined;
		return {
			...this.models.info,
			pov: pov
				? {
						name: pov.name,
						weapon: this.players[this.pov!]?.weapon ?? null,
						crosshair: pov.crosshair ?? null,
						viewmodel: this.models.viewmodel?.info ?? null
					}
				: null
		};
	}

	get stats(): {
		programs: number;
		failedPrograms: string[];
		textureUnits: number;
		textures: number;
		geometries: number;
	} {
		const info = this.renderer.info;
		const gl = this.renderer.getContext();
		return {
			programs: info.programs?.length ?? 0,
			failedPrograms: (info.programs ?? [])
				.filter(
					(program) =>
						(program as { diagnostics?: { runnable: boolean } }).diagnostics?.runnable === false
				)
				.map((program) => program.name),
			textureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
			textures: info.memory.textures,
			geometries: info.memory.geometries
		};
	}

	private applyScale() {
		const wanted =
			this.graphics.resolution === 'auto' ? this.autoScale.scale : this.graphics.resolution;
		this.scale = wanted;
		const ratio = this.pixelRatio * wanted;
		this.renderer.setPixelRatio(ratio);
		this.renderer.setSize(this.width, this.height, false);
		this.pack?.post.setSize(Math.round(this.width * ratio), Math.round(this.height * ratio));
		this.dirty = true;
		profiler.note(`render scale ${wanted.toFixed(2)}`);
	}

	frameDone(now: number, busy: boolean) {
		if (this.graphics.resolution !== 'auto') return;
		const next = this.autoScale.sample(now, busy);
		if (next !== null && next !== this.scale) this.applyScale();
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
				this.mapObject.updateMatrixWorld();
				this.sunShadow?.dispose();
				this.sunShadow = null;
				try {
					this.sunShadow = bakeSunShadow(this.renderer, this.mapObject, SUN_DIRECTION, SHADOW_SIZE);
				} catch (error) {
					console.warn('No sun shadows for the collision map', error);
				}
				applyShadow(this.mapMaterial, this.sunShadow, SHADOW_SIZE);
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
				pack.post.setSamples(this.graphics.msaa);
				this.applyScale();
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
		skins: string | null = null,
		agents: string | null = null
	) {
		const key = version ? `${version}@${quality}@${skins ?? ''}@${agents ?? ''}` : '';
		if (key === this.modelsKey) return;
		this.modelsKey = key;
		this.clearModels();
		if (!version) return;
		import('./cs2/players.ts')
			.then(async ({ PlayerModels, PlayerPack }) => {
				const pack = await PlayerPack.load(this.renderer, version, quality, skins, agents);
				if (this.modelsKey !== key) {
					pack.dispose();
					return;
				}
				pack.onChange = this.markDirty;
				const models = new PlayerModels(pack);
				this.models = models;
				models.onChange = this.markDirty;
				if (models.viewmodel) models.viewmodel.onChange = this.markDirty;
				models.viewmodel?.setConfig(this.config);
				this.viewmodelKey = '';
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

	setConfig(config: AppConfig) {
		this.config = config;
		this.viewmodelKey = '';
		this.models?.viewmodel?.setConfig(config);
		if (this.mode === 'pov') {
			this.camera.fov = this.povFov;
			this.camera.updateProjectionMatrix();
		}
		this.dirty = true;
	}

	private get povFov(): number {
		return horizontalToVerticalFov(this.config.pov.fov);
	}

	invalidate() {
		this.dirty = true;
	}

	resetView() {
		this.framedMap = null;
		this.dirty = true;
	}

	render(frame: SceneFrame): boolean {
		const { replay, tick, focus, mode, roofs, xray = true } = frame;
		this.replay = replay;
		this.tick = tick;
		this.xray = xray;
		if (replay.meta.round !== this.round) {
			this.round = replay.meta.round;
			this.actors.setPlayers(replay.meta.players);
			this.models?.setPlayers(replay.meta.players, sideColors);
			this.updateHeightRange(replay);
			this.dirty = true;
		}
		if (this.framedMap !== (this.map?.name ?? '')) this.frame(replay);
		if (mode !== this.mode) this.switchMode(mode);

		const key = `${tick}|${focus}|${mode}|${roofs}|${xray}|${this.round}`;
		if (key !== this.lastKey) {
			this.lastKey = key;
			this.dirty = true;
		}
		this.fly();
		if (this.controls.enabled) this.controls.update();
		if (!this.dirty) return false;
		this.dirty = false;
		this.renderer.info.reset();

		profiler.begin('state');
		this.players = playerStates(replay, tick);
		const focused = focus !== null ? this.players[focus] : undefined;
		this.pov = mode === 'pov' && focused?.alive ? focus : null;

		const glides = mode === 'follow' || mode === 'chase';
		if (glides && focus !== this.transitionFocus && this.transitionFocus !== null) {
			this.transition = {
				position: this.shown.position.clone(),
				quaternion: this.shown.quaternion.clone(),
				start: performance.now()
			};
		}
		if (!glides) this.transition = null;
		this.transitionFocus = glides ? focus : null;

		if (mode === 'follow' && focused?.alive) this.follow(focused);
		else this.followAnchor = null;
		if (mode === 'chase' && focused?.alive) this.chase(focused);
		else this.chaseYaw = null;
		this.povPose = mode === 'pov' && focused ? this.placePov(replay, tick, focused) : null;
		const pov = this.config.pov;
		this.scope = this.pov !== null && pov.scope ? scopeOf(focused) : null;
		this.blind = this.pov !== null && pov.flash ? (focused?.blind ?? 0) : 0;
		this.hurt = this.pov !== null && pov.hitFlash ? hurtFlash(replay, this.pov, tick) : 0;
		if (mode === 'pov') {
			const fov = this.scope?.fov ?? this.povFov;
			if (this.camera.fov !== fov) {
				this.camera.fov = fov;
				this.camera.updateProjectionMatrix();
			}
		}

		profiler.end('state');
		const debug = this.debug;
		const cutZ = roofs ? 1e9 : this.cutHeight(focused) + ROOF_CUT;
		this.mapMaterial.uniforms.uCutZ!.value = cutZ;
		this.pack?.setCutZ(cutZ);
		const models = this.models?.active && debug.models ? this.models : null;
		profiler.begin('actors');
		this.actors.setCapsules(!this.models?.active);
		this.actors.update(
			replay,
			tick,
			this.players,
			focus,
			this.pov,
			this.sizeOf,
			mode === 'free' || mode === 'follow' ? focus : null
		);
		profiler.end('actors');
		profiler.begin('models');
		if (this.models) this.models.root.visible = debug.models;
		models?.update(replay, tick, this.players, this.pov, xray && debug.ghosts);
		if (this.effects) models?.updateProps(replay, tick);
		profiler.end('models');
		this.camera.updateMatrixWorld();
		profiler.begin('viewmodel');
		if (this.pov !== null) this.applyPlayerViewmodel(replay.meta.players[this.pov]?.viewmodel);
		const viewmodel =
			this.pov !== null && pov.viewmodel && debug.viewmodel && !this.scope?.sniper
				? (this.models?.updateViewmodel(
						replay,
						tick,
						this.players[this.pov] ?? null,
						this.camera,
						this.povPose
					) ?? null)
				: null;
		profiler.end('viewmodel');
		profiler.begin('effects');
		if (this.effects) this.effects.root.visible = debug.effects;
		if (debug.effects)
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
		profiler.end('effects');
		const gliding = this.applyTransition();
		profiler.begin('draw');
		if (this.pack) this.renderPack(this.pack, viewmodel);
		else {
			profiler.gpuBegin('world');
			this.renderer.render(this.scene, this.camera);
			profiler.gpuEnd();
		}
		profiler.end('draw');
		profiler.begin('overlay');
		this.drawOverlay(focus);
		profiler.end('overlay');
		if (gliding) {
			this.camera.position.copy(this.desired.position);
			this.camera.quaternion.copy(this.desired.quaternion);
			this.camera.updateMatrixWorld();
		}
		if (this.syncTiming) {
			profiler.begin('gpu wait');
			const gl = this.renderer.getContext();
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncPixel);
			profiler.end('gpu wait');
		}
		return true;
	}

	private renderPack(pack: MapPack, viewmodel: Viewmodel | null) {
		const renderer = this.renderer;
		if (this.models?.bake(renderer).pending) this.dirty = true;
		this.camera.updateMatrixWorld();
		pack.update(this.camera, (performance.now() - this.started) / 1000);
		const background = this.scene.background;
		this.scene.background = null;
		renderer.autoClear = false;
		renderer.setClearColor(0x000000, 1);
		pack.main.visible = this.debug.world;
		pack.post.setCompactColor(this.debug.compactColor);
		profiler.gpuBegin('skybox');
		if (pack.skyboxScene && this.debug.world) {
			renderer.setRenderTarget(pack.post.skyTarget);
			renderer.clear(true, true, false);
			renderer.render(pack.skyboxScene, pack.skyboxCamera);
			this.scene.background = pack.post.skyTarget.texture;
		}
		renderer.setRenderTarget(pack.post.target);
		renderer.clear(true, true, true);
		if (this.debug.world && this.debug.prepass) {
			profiler.gpuBegin('prepass');
			pack.renderPrepass(renderer, this.camera);
		}
		profiler.gpuBegin('world');
		renderer.render(this.scene, this.camera);
		if (viewmodel) {
			profiler.gpuBegin('viewmodel');
			renderer.clearDepth();
			renderer.render(viewmodel.scene, viewmodel.camera);
		}
		profiler.gpuBegin('post');
		pack.post.render(renderer, this.debug.bloom);
		profiler.gpuEnd();
		renderer.autoClear = true;
		renderer.setClearColor(background as THREE.Color);
		this.scene.background = background;
	}

	dispose() {
		this.sunShadow?.dispose();
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
		profiler.detachGl();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}

	private markDirty = () => {
		this.dirty = true;
	};

	private sizeOf = (player: PlayerState): number => {
		if (this.mode === 'pov' || this.mode === 'chase' || this.models?.active) return 1;
		const distance = this.projected
			.set(player.x, player.y, player.z)
			.distanceTo(this.camera.position);
		return Math.min(MAX_PLAYER_SCALE, Math.max(1, distance / 1600));
	};

	get flying(): boolean {
		return this.mode === 'free';
	}

	private lookAround(dx: number, dy: number) {
		const offset = this.controls.target.clone().sub(this.camera.position);
		const distance = Math.max(1, offset.length());
		const yaw = Math.atan2(offset.y, offset.x) - dx * LOOK_SPEED;
		const pitch = Math.max(
			-1.5,
			Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, offset.z / distance))) - dy * LOOK_SPEED)
		);
		this.controls.target.set(
			this.camera.position.x + Math.cos(pitch) * Math.cos(yaw) * distance,
			this.camera.position.y + Math.cos(pitch) * Math.sin(yaw) * distance,
			this.camera.position.z + Math.sin(pitch) * distance
		);
		this.camera.lookAt(this.controls.target);
		this.dirty = true;
	}

	private fly() {
		const now = performance.now();
		const dt = Math.min(0.25, (now - this.lastFly) / 1000);
		this.lastFly = now;
		if (this.mode !== 'free' || !this.flyKeys.size) return;
		const keys = this.flyKeys;
		const forward = this.controls.target.clone().sub(this.camera.position).normalize();
		const right = forward.clone().cross(this.camera.up).normalize();
		const move = new THREE.Vector3();
		if (keys.has('KeyW')) move.add(forward);
		if (keys.has('KeyS')) move.sub(forward);
		if (keys.has('KeyD')) move.add(right);
		if (keys.has('KeyA')) move.sub(right);
		if (keys.has('KeyE')) move.z += 1;
		if (keys.has('KeyQ')) move.z -= 1;
		if (!move.lengthSq()) return;
		const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
		move.normalize().multiplyScalar(FLY_SPEED * (fast ? 3 : 1) * dt);
		this.camera.position.add(move);
		this.controls.target.add(move);
		this.dirty = true;
	}

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
		if (this.mode === 'pov' || this.mode === 'chase') this.mode = 'free';
		this.followAnchor = null;
		this.controls.enabled = true;
		this.camera.fov = ORBIT_FOV;
		this.camera.updateProjectionMatrix();
		this.controls.update();
		this.framedMap = map?.name ?? '';
		this.dirty = true;
	}

	private switchMode(mode: CameraMode) {
		const fixed = (m: CameraMode) => m === 'pov' || m === 'chase';
		if (fixed(mode) && fixed(this.mode)) {
			this.camera.fov = mode === 'pov' ? this.povFov : CHASE_FOV;
		} else if (mode === 'chase') {
			this.orbit.position.copy(this.camera.position);
			this.orbit.target.copy(this.controls.target);
			this.controls.enabled = false;
			this.camera.fov = CHASE_FOV;
		} else if (this.mode === 'chase') {
			this.camera.position.copy(this.orbit.position);
			this.controls.target.copy(this.orbit.target);
			this.controls.enabled = true;
			this.camera.fov = ORBIT_FOV;
			this.controls.update();
		} else if (mode === 'pov') {
			this.orbit.position.copy(this.camera.position);
			this.orbit.target.copy(this.controls.target);
			this.controls.enabled = false;
			this.camera.fov = this.povFov;
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

	private chase(player: PlayerState) {
		const now = performance.now();
		const dt = Math.min(0.25, (now - this.lastChase) / 1000);
		this.lastChase = now;
		const eye = new THREE.Vector3(player.x, player.y, player.z + eyeHeight(player));
		const keep = this.chaseYaw === null ? 1 : 1 - Math.exp(-dt * CHASE_FOLLOW);
		this.chaseYaw =
			this.chaseYaw === null ? player.yaw : lerpAngle(this.chaseYaw, player.yaw, keep);
		this.chasePitch += (Math.max(-30, Math.min(40, player.pitch)) * 0.5 - this.chasePitch) * keep;
		const yaw = this.chaseYaw * (Math.PI / 180);
		const pitch = this.chasePitch * (Math.PI / 180);
		const back = new THREE.Vector3(
			-Math.cos(pitch) * Math.cos(yaw),
			-Math.cos(pitch) * Math.sin(yaw),
			Math.sin(pitch) * 0.6 + 0.18
		).normalize();
		const raycaster = this.chaseRaycaster();
		const hit = raycaster?.cast([eye.x, eye.y, eye.z], [back.x, back.y, back.z], CHASE_DISTANCE);
		const wanted = hit ? Math.max(CHASE_MIN, hit.distance - CHASE_CLEARANCE) : CHASE_DISTANCE;
		this.chaseDistance =
			wanted < this.chaseDistance
				? wanted
				: this.chaseDistance + (wanted - this.chaseDistance) * (1 - Math.exp(-dt * 4));
		this.camera.position.copy(eye).addScaledVector(back, this.chaseDistance);
		const ahead = new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), -Math.sin(pitch) * 0.4);
		this.camera.lookAt(eye.clone().addScaledVector(ahead, 60));
		if (
			Math.abs(((player.yaw - this.chaseYaw + 540) % 360) - 180) > 0.2 ||
			Math.abs(wanted - this.chaseDistance) > 0.5
		)
			this.dirty = true;
	}

	private chaseRaycaster(): MeshRaycaster | null {
		if (!this.mesh) return null;
		if (this.raycasterMesh !== this.mesh) {
			this.raycasterMesh = this.mesh;
			this.raycaster3 = new MeshRaycaster(this.mesh);
		}
		return this.raycaster3;
	}

	private applyTransition(): boolean {
		const transition = this.transition;
		if (transition) {
			const t = (performance.now() - transition.start) / (GLIDE_SECONDS * 1000);
			if (t >= 1) this.transition = null;
			else {
				const eased = 1 - (1 - t) ** 3;
				this.desired.position.copy(this.camera.position);
				this.desired.quaternion.copy(this.camera.quaternion);
				this.camera.position.lerpVectors(transition.position, this.desired.position, eased);
				this.camera.quaternion.slerpQuaternions(
					transition.quaternion,
					this.desired.quaternion,
					eased
				);
				this.camera.updateMatrixWorld();
				this.shown.position.copy(this.camera.position);
				this.shown.quaternion.copy(this.camera.quaternion);
				this.dirty = true;
				return true;
			}
		}
		this.shown.position.copy(this.camera.position);
		this.shown.quaternion.copy(this.camera.quaternion);
		return false;
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
		const yaw = (view?.yaw ?? player.yaw) + (view?.punchYaw ?? 0) * this.config.pov.recoil;
		const pitch = (view?.pitch ?? player.pitch) + (view?.punchPitch ?? 0) * this.config.pov.recoil;
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

	private drawUtilityTimers(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const replay = this.replay;
		if (!replay) return;
		const ratio = this.pixelRatio;
		const r = 10 * ratio;
		for (const effect of replay.meta.effects) {
			if (effect.type !== 'smoke' && effect.type !== 'molotov') continue;
			if (this.tick < effect.startTick || this.tick > effect.endTick) continue;
			const lift = effect.type === 'smoke' ? 150 : 30;
			this.projected.set(effect.x, effect.y, effect.z + lift).project(this.camera);
			const ndc = this.projected;
			if (ndc.z <= -1 || ndc.z >= 1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) continue;
			const x = ((ndc.x + 1) / 2) * width;
			const y = ((1 - ndc.y) / 2) * height;
			const left = (effect.endTick - this.tick) / replay.meta.tickRate;
			const total = (effect.endTick - effect.startTick) / replay.meta.tickRate;
			const color = effect.type === 'smoke' ? '#eef1f5' : '#ffb47a';
			ctx.fillStyle = 'rgba(10, 12, 15, 0.72)';
			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = color;
			ctx.lineWidth = 2 * ratio;
			ctx.beginPath();
			ctx.arc(x, y, r - ratio, -Math.PI / 2, -Math.PI / 2 + (left / total) * Math.PI * 2);
			ctx.stroke();
			ctx.fillStyle = color;
			ctx.font = `600 ${Math.round(r)}px system-ui, sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(Math.ceil(left)), x, y + 0.5 * ratio);
		}
	}

	private drawOverlay(focus: number | null) {
		const ctx = this.overlay;
		const ratio = this.pixelRatio;
		const width = ctx.canvas.width;
		const height = ctx.canvas.height;
		const names = this.pov === null && this.config.viewer.nameplates;
		const tags = this.pov !== null && this.xray && this.config.viewer.nameplates;
		const crosshair = this.pov !== null && (this.scope !== null || this.config.pov.crosshair);
		const empty =
			!this.debug.overlay || (!names && !tags && !crosshair && this.hurt <= 0 && this.blind <= 0);
		if (empty && !this.overlayDirty) return;
		ctx.clearRect(0, 0, width, height);
		this.overlayDirty = !empty;
		if (empty) return;

		if (this.pov !== null && this.scope) {
			this.drawScope(ctx, width, height, this.scope.sniper);
		} else if (this.pov !== null && this.config.pov.crosshair) {
			this.drawCrosshair(ctx, width / 2, height / 2);
		}

		const fontSize = Math.round(11.5 * ratio);
		ctx.font = `600 ${fontSize}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'bottom';

		const labels = this.players
			.filter((p) => names && p.alive && p.present)
			.map((player) => {
				const lift = (player.ducking ? 66 : 84) * this.sizeOf(player);
				this.projected.set(player.x, player.y, player.z + lift).project(this.camera);
				return { player, ndc: this.projected.clone() };
			})
			.filter(
				({ ndc }) => ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2
			)
			.sort((a, b) => b.ndc.z - a.ndc.z);

		const lineHeight = fontSize + 8 * ratio;
		const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
		const positioned = labels
			.map(({ player, ndc }) => {
				const name = player.name.length > 14 ? `${player.name.slice(0, 13)}…` : player.name;
				const label = player.bomb ? `${name} · C4` : name;
				const half = Math.max(17 * ratio, ctx.measureText(label).width / 2) + 2 * ratio;
				return {
					player,
					label,
					half,
					x: ((ndc.x + 1) / 2) * width,
					y: ((1 - ndc.y) / 2) * height,
					depth: ndc.z
				};
			})
			.sort((a, b) => a.depth - b.depth);
		for (const item of positioned) {
			for (let attempt = 0; attempt < 6; attempt++) {
				const box = {
					x0: item.x - item.half,
					x1: item.x + item.half,
					y0: item.y - lineHeight,
					y1: item.y + 2 * ratio
				};
				const hit = placed.find(
					(other) =>
						box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0
				);
				if (!hit) {
					placed.push(box);
					break;
				}
				item.y = hit.y0 - 2 * ratio;
			}
		}

		for (const { player, label, x, y } of positioned.reverse()) {
			const focused = player.index === focus;
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
		if (names) this.drawUtilityTimers(ctx, width, height);
		if (tags) this.drawXrayTags(ctx, width, height);

		if (this.hurt > 0) {
			const alpha = 0.6 * this.hurt;
			for (const [from, to] of [
				[0, width * 0.3],
				[width, width * 0.7]
			] as const) {
				const edge = ctx.createLinearGradient(from, 0, to, 0);
				edge.addColorStop(0, `rgba(190, 10, 10, ${alpha})`);
				edge.addColorStop(0.45, `rgba(190, 10, 10, ${alpha * 0.35})`);
				edge.addColorStop(1, 'rgba(190, 10, 10, 0)');
				ctx.fillStyle = edge;
				ctx.fillRect(0, 0, width, height);
			}
		}
		if (this.blind > 0) {
			ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, this.blind * 1.05)})`;
			ctx.fillRect(0, 0, width, height);
		}
	}

	private drawXrayTags(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const viewer = this.pov !== null ? this.players[this.pov] : undefined;
		if (!viewer) return;
		const ratio = this.pixelRatio;
		const order = this.players
			.filter((p) => p.present && p.side !== viewer.side)
			.sort((a, b) => a.index - b.index);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'bottom';
		for (const [slot, player] of order.entries()) {
			if (!player.alive) continue;
			const lift = player.ducking ? 62 : 80;
			this.projected.set(player.x, player.y, player.z + lift).project(this.camera);
			const ndc = this.projected;
			if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) continue;
			const x = ((ndc.x + 1) / 2) * width;
			const y = ((1 - ndc.y) / 2) * height;
			const color = SLOT_COLORS[slot % SLOT_COLORS.length]!;
			const size = 4 * ratio;
			ctx.globalAlpha = 0.9;
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(x - size, y - size * 1.6);
			ctx.lineTo(x + size, y - size * 1.6);
			ctx.lineTo(x, y);
			ctx.closePath();
			ctx.fill();
			ctx.lineWidth = 2.5 * ratio;
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
			ctx.font = `600 ${Math.round(9.5 * ratio)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
			const health = `${player.health}%`;
			ctx.strokeText(health, x, y - size * 2);
			ctx.fillStyle = '#f0e6a0';
			ctx.fillText(health, x, y - size * 2);
			ctx.font = `600 ${Math.round(11 * ratio)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
			const nameY = y - size * 2 - 11 * ratio;
			ctx.strokeText(player.name, x, nameY);
			ctx.fillStyle = color;
			ctx.fillText(player.name, x, nameY);
		}
		ctx.globalAlpha = 1;
	}

	private applyPlayerViewmodel(settings: [number, number, number, number] | undefined) {
		const use = this.config.pov.playerViewmodel && settings;
		const key = use ? settings.join(',') : '';
		if (key === this.viewmodelKey) return;
		this.viewmodelKey = key;
		const pov = this.config.pov;
		this.models?.viewmodel?.setConfig(
			use
				? {
						...this.config,
						pov: {
							...pov,
							offsetX: settings[1],
							offsetY: settings[2],
							offsetZ: settings[3]
						}
					}
				: this.config
		);
	}

	private playerCrosshair(): Crosshair | null {
		if (!this.config.pov.playerCrosshair || this.pov === null) return null;
		const code = this.replay?.meta.players[this.pov]?.crosshair;
		if (!code) return null;
		let crosshair = this.crosshairs.get(code);
		if (crosshair === undefined) {
			crosshair = decodeCrosshair(code);
			this.crosshairs.set(code, crosshair);
		}
		return crosshair;
	}

	private drawPlayerCrosshair(
		ctx: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		height: number,
		crosshair: Crosshair
	) {
		const scale = height / crosshair.screenHeight;
		const px = (value: number, min: number) => Math.max(min, Math.round(value * scale));
		const thick = px(crosshair.thickness, 1);
		const length = px(crosshair.length, 1);
		const gap = Math.round(Math.max(0, crosshair.gap) * scale);
		const half = thick / 2;
		const outline = crosshair.outline;
		const ow = outline ? px(outline.width, 1) : 0;
		const style = crosshair.style;
		const ring = style === 1 || style === 3 || style === 7 || style === 9;
		if (ring) {
			const radius = gap + length / 2 + half;
			const parts = style === 7 || style === 9 ? 4 : 1;
			const span = parts === 1 ? Math.PI * 2 : (Math.PI / 2) * Math.max(0.1, crosshair.splitRatio);
			const stroke = (width: number, color: string) => {
				ctx.lineWidth = width;
				ctx.strokeStyle = color;
				for (let i = 0; i < parts; i++) {
					const mid = parts === 1 ? 0 : (i * Math.PI) / 2;
					ctx.beginPath();
					ctx.arc(cx, cy, radius, mid - span / 2, mid + span / 2);
					ctx.stroke();
				}
			};
			if (outline) stroke(thick + 2 * ow, rgbaCss(outline.color));
			stroke(thick, crosshairColor(crosshair));
		}
		const bars: [number, number, number, number][] = [];
		if (style === 8) {
			const side = 2 * (gap + length);
			const x = cx - side / 2;
			const y = cy - side / 2;
			bars.push([x, y, side, thick], [x, y + side - thick, side, thick]);
			bars.push([x, y, thick, side], [x + side - thick, y, thick, side]);
		} else if (!ring && style !== 6) {
			bars.push([cx - gap - length - half, cy - half, length, thick]);
			bars.push([cx + gap + half, cy - half, length, thick]);
			bars.push([cx - half, cy + gap + half, thick, length]);
			if (!crosshair.tStyle) bars.push([cx - half, cy - gap - length - half, thick, length]);
		}
		if (crosshair.dot || style === 6) bars.push([cx - half, cy - half, thick, thick]);
		if (outline) {
			ctx.fillStyle = rgbaCss(outline.color);
			const grow = outline.half ? 0 : ow;
			for (const [x, y, w, h] of bars) ctx.fillRect(x - ow, y - ow, w + ow + grow, h + ow + grow);
		}
		ctx.fillStyle = crosshairColor(crosshair);
		for (const [x, y, w, h] of bars) ctx.fillRect(x, y, w, h);
	}

	private drawCrosshair(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
		const own = this.playerCrosshair();
		if (own) {
			this.drawPlayerCrosshair(ctx, Math.round(cx), Math.round(cy), ctx.canvas.height, own);
			return;
		}
		const { crosshairColor, crosshairSize, crosshairGap, crosshairThickness, crosshairDot } =
			this.config.pov;
		const ratio = this.pixelRatio;
		const size = crosshairSize * ratio;
		const gap = crosshairGap * ratio;
		const thick = crosshairThickness * ratio;
		ctx.fillStyle = crosshairColor;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
		ctx.lineWidth = Math.max(1, ratio);
		const bars: [number, number, number, number][] = [
			[cx - gap - size, cy - thick / 2, size, thick],
			[cx + gap, cy - thick / 2, size, thick],
			[cx - thick / 2, cy - gap - size, thick, size],
			[cx - thick / 2, cy + gap, thick, size]
		];
		if (crosshairDot) bars.push([cx - thick / 2, cy - thick / 2, thick, thick]);
		for (const [x, y, w, h] of bars) {
			ctx.strokeRect(x, y, w, h);
			ctx.fillRect(x, y, w, h);
		}
	}

	private drawScope(ctx: CanvasRenderingContext2D, width: number, height: number, sniper: boolean) {
		const ratio = this.pixelRatio;
		const cx = width / 2;
		const cy = height / 2;
		const radius = height * (sniper ? 0.42 : 0.38);
		ctx.fillStyle = '#000';
		ctx.beginPath();
		ctx.rect(0, 0, width, height);
		ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
		ctx.fill();
		const edge = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius);
		edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
		edge.addColorStop(0.65, 'rgba(36, 22, 10, 0.3)');
		edge.addColorStop(0.9, 'rgba(18, 11, 5, 0.8)');
		edge.addColorStop(1, 'rgba(0, 0, 0, 1)');
		ctx.fillStyle = edge;
		ctx.beginPath();
		ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
		ctx.fill();
		if (sniper) {
			ctx.fillStyle = '#000';
			const thin = Math.max(1, ratio);
			ctx.fillRect(0, cy - thin / 2, width, thin);
			ctx.fillRect(cx - thin / 2, 0, thin, height);
		} else {
			ctx.fillStyle = 'rgba(255, 40, 30, 0.95)';
			ctx.beginPath();
			ctx.arc(cx, cy, 2.2 * ratio, 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

const HURT_SECONDS = 0.45;

function hurtFlash(replay: RoundReplay, player: number, tick: number): number {
	const hurts = replay.meta.hurts;
	if (!hurts) return 0;
	let strongest = 0;
	for (let i = 0; i + 5 < hurts.length; i += 6) {
		const at = hurts[i]!;
		if (at > tick) break;
		if (hurts[i + 1] !== player) continue;
		const age = (tick - at) / replay.meta.tickRate;
		if (age > HURT_SECONDS) continue;
		strongest = Math.max(
			strongest,
			(1 - age / HURT_SECONDS) * Math.min(1, 0.35 + hurts[i + 3]! / 40)
		);
	}
	return strongest;
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

class AutoScale {
	scale = 1;
	private intervals: number[] = [];
	private last = 0;
	private changedAt = 0;
	private before = 0;
	private lockedUntil = 0;
	private vsync = Infinity;
	private ceiling = 1;
	private ceilingUntil = 0;

	reset() {
		this.intervals = [];
		this.last = 0;
		this.before = 0;
	}

	sample(now: number, busy: boolean): number | null {
		const interval = this.last ? now - this.last : 0;
		this.last = now;
		if (!busy || interval <= 0 || interval > 250) {
			this.intervals = [];
			return null;
		}
		this.vsync = Math.min(this.vsync * 1.002, Math.max(4, interval));
		this.intervals.push(interval);
		if (this.intervals.length < 40) return null;
		const sorted = [...this.intervals].sort((a, b) => a - b);
		const typical = sorted[Math.floor(sorted.length * 0.6)]!;
		this.intervals = [];
		const budget = Math.max(this.vsync, 1000 / 144);
		if (this.before && now - this.changedAt < 3000) {
			const helped = typical < this.before * 0.93;
			this.before = 0;
			if (!helped && this.scale < 1) {
				this.scale = Math.min(1, Math.round((this.scale / 0.85) * 20) / 20);
				this.lockedUntil = now + 15000;
				this.changedAt = now;
				return this.scale;
			}
		}
		if (now < this.lockedUntil || now - this.changedAt < 1000) return null;
		if (typical > budget * 1.3 && this.scale > MIN_AUTO_SCALE) {
			this.before = typical;
			this.ceiling = Math.max(MIN_AUTO_SCALE, this.scale - 0.05);
			this.ceilingUntil = now + 30000;
			this.scale = Math.max(MIN_AUTO_SCALE, Math.round(this.scale * 0.85 * 20) / 20);
			this.changedAt = now;
			return this.scale;
		}
		const ceiling = now < this.ceilingUntil ? this.ceiling : 1;
		if (typical < budget * 1.08 && this.scale < ceiling && now - this.changedAt > 4000) {
			this.scale = Math.min(1, Math.round((this.scale + 0.05) * 20) / 20);
			this.changedAt = now;
			return this.scale;
		}
		return null;
	}
}
