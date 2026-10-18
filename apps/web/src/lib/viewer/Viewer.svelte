<script lang="ts">
	import { untrack } from 'svelte';
	import {
		defaultConfig,
		maps,
		type AppConfig,
		weaponTitle,
		type MapMesh,
		type RoundReplay,
		type Side,
		type TeamKey
	} from '@cs-demo-cloud/replay';
	import { formatClock } from '#lib/format.ts';
	import { EAR_HEIGHT, ReplayAudio, type Listener } from './audio.ts';
	import { drawFrame, sideColors } from './draw.ts';
	import GameHud from './GameHud.svelte';
	import PerfPanel from './PerfPanel.svelte';
	import { Benchmark } from './bench.ts';
	import { defaultGraphics, type GraphicsSettings, type Resolution } from './graphics.ts';
	import { profiler, summarize } from './perf.ts';
	import { bombState, lastTick, playerStates } from './frame.ts';
	import { loadMapMesh, loadRound } from './loader.ts';
	import type { CameraMode, PackStatus, ReplayScene, TextureQuality } from './three/scene.ts';

	interface RoundInfo {
		number: number;
		teamASide: Side;
		winnerSide: Side | null;
		winnerTeam: TeamKey | null;
		reason: string | null;
		scoreA: number;
		scoreB: number;
	}

	interface Props {
		demoId: string;
		version: number;
		map: string;
		mapPack: string | null;
		playerPack: string | null;
		skinsPack?: string | null;
		rounds: RoundInfo[];
		teamNames: Record<TeamKey, string>;
		config?: AppConfig;
	}

	let {
		demoId,
		version,
		map,
		mapPack,
		playerPack,
		skinsPack = null,
		rounds,
		teamNames,
		config = defaultConfig
	}: Props = $props();

	const ROUND_SECONDS = $derived(config.viewer.roundSeconds);
	const BOMB_SECONDS = $derived(config.viewer.bombSeconds);
	const speeds = [0.5, 1, 2, 4, 8];
	const teamKeys: TeamKey[] = ['a', 'b'];
	const cameraModes: { mode: CameraMode; label: string }[] = [
		{ mode: 'free', label: 'Free' },
		{ mode: 'follow', label: 'Follow' },
		{ mode: 'pov', label: 'POV' }
	];
	const viewKey = 'viewer.view';
	const qualityKey = 'viewer.textures';
	const soundKey = 'viewer.sound';
	const hudKey = 'viewer.hud';
	const xrayKey = 'viewer.xray';
	const graphicsKey = 'viewer.graphics';
	const resolutions: { value: Resolution; label: string }[] = [
		{ value: 'auto', label: 'Resolution: auto' },
		{ value: 1, label: 'Resolution: 100%' },
		{ value: 0.85, label: 'Resolution: 85%' },
		{ value: 0.7, label: 'Resolution: 70%' },
		{ value: 0.5, label: 'Resolution: 50%' }
	];
	const msaaOptions: { value: GraphicsSettings['msaa']; label: string }[] = [
		{ value: 4, label: 'Anti-aliasing: 4×' },
		{ value: 2, label: 'Anti-aliasing: 2×' },
		{ value: 0, label: 'Anti-aliasing: off' }
	];
	const qualities: { value: TextureQuality; label: string }[] = [
		{ value: 'auto', label: 'Textures: auto' },
		{ value: 'high', label: 'Textures: high' },
		{ value: 'medium', label: 'Textures: medium' },
		{ value: 'low', label: 'Textures: low' }
	];

	const mapInfo = $derived(maps[map] ?? null);

	let round = $state(1);
	let replay = $state.raw<RoundReplay | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let tick = $state(0);
	let hudTick = $state(0);
	let playing = $state(false);
	const initial = untrack(() => config);
	let speed = $state(initial.viewer.speed);
	let level = $state<'upper' | 'lower'>('upper');
	let focus = $state<number | null>(null);
	let view = $state<'2d' | '3d'>(savedView());
	let cameraMode = $state<CameraMode>(initial.viewer.camera);
	let roofs = $state(true);
	let scene3d = $state.raw<ReplayScene | null>(null);
	let canvas3d = $state<HTMLCanvasElement | null>(null);
	let overlay3d = $state<HTMLCanvasElement | null>(null);
	let mesh = $state.raw<MapMesh | null | undefined>(undefined);
	let meshError = $state<string | null>(null);
	let sceneError = $state<string | null>(null);
	let packStatus = $state<PackStatus>({ state: 'none' });
	let textureQuality = $state<TextureQuality>(savedQuality());
	let audio = $state.raw<ReplayAudio | null>(null);
	let soundOn = $state(savedSound());
	let hudOn = $state(savedFlag(hudKey, initial.viewer.hud));
	let xrayOn = $state(savedFlag(xrayKey, initial.viewer.xray));
	let theater = $state(false);
	let graphics = $state<GraphicsSettings>(savedGraphics());
	let perfOpen = $state(perfRequested());
	let bench = $state.raw<Benchmark | null>(null);
	let benchStatus = $state<string | null>(null);
	let renderScale = $state(1);
	let innerWidth = $state(1280);
	let idle = $state(false);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;

	let radar = $state.raw<HTMLImageElement | null>(null);
	let lowerRadar = $state.raw<HTMLImageElement | null>(null);
	let wrapWidth = $state(0);
	let innerHeight = $state(800);
	let pixelRatio = $state(1);
	let canvas = $state<HTMLCanvasElement | null>(null);

	const cssSize = $derived(Math.max(240, Math.min(wrapWidth, innerHeight - 190)));
	const canvasPx = $derived(Math.round(cssSize * pixelRatio));
	const stageWidth = $derived(
		theater ? innerWidth : view === '3d' ? Math.max(240, wrapWidth) : cssSize
	);
	const stageHeight = $derived(
		theater
			? innerHeight
			: view === '3d'
				? Math.max(240, Math.min(Math.round((stageWidth * 9) / 16), innerHeight - 150))
				: cssSize
	);
	const roundInfo = $derived(rounds.find((r) => r.number === round) ?? null);
	const previousRound = $derived(rounds.find((r) => r.number === round - 1) ?? null);
	const end = $derived(replay ? lastTick(replay) : 0);
	const hudPlayers = $derived(replay ? playerStates(replay, hudTick) : []);

	function savedView(): '2d' | '3d' {
		try {
			const saved = localStorage.getItem(viewKey);
			return saved === '3d' || saved === '2d' ? saved : config.viewer.view;
		} catch {
			return config.viewer.view;
		}
	}

	function setView(next: '2d' | '3d') {
		view = next;
		try {
			localStorage.setItem(viewKey, next);
		} catch {
			return;
		}
	}

	function savedFlag(key: string, fallback: boolean): boolean {
		try {
			const value = localStorage.getItem(key);
			return value === null ? fallback : value === 'on';
		} catch {
			return fallback;
		}
	}

	function toggleXray() {
		xrayOn = !xrayOn;
		try {
			localStorage.setItem(xrayKey, xrayOn ? 'on' : 'off');
		} catch {
			return;
		}
	}

	function toggleHud() {
		hudOn = !hudOn;
		try {
			localStorage.setItem(hudKey, hudOn ? 'on' : 'off');
		} catch {
			return;
		}
	}

	function setTheater(next: boolean) {
		theater = next;
		if (next) {
			if (view !== '3d') setView('3d');
			document.documentElement.requestFullscreen?.().catch(() => {});
		} else if (document.fullscreenElement) {
			document.exitFullscreen().catch(() => {});
		}
		wake();
	}

	function wake() {
		idle = false;
		clearTimeout(idleTimer);
		if (theater) idleTimer = setTimeout(() => (idle = playing), 2500);
	}

	function savedSound(): boolean {
		try {
			return localStorage.getItem(soundKey) !== 'off';
		} catch {
			return true;
		}
	}

	function toggleSound() {
		soundOn = !soundOn;
		audio?.unlock();
		try {
			localStorage.setItem(soundKey, soundOn ? 'on' : 'off');
		} catch {
			return;
		}
	}

	function listener(current: RoundReplay): Listener | null {
		const heard = earOf(current);
		if (!heard) return null;
		const side = focus !== null ? (current.meta.players[focus]?.side ?? null) : null;
		const player = view === '3d' && cameraMode === 'pov' ? focus : null;
		return { ...heard, side, player };
	}

	function earOf(current: RoundReplay): Listener | null {
		if (view === '3d') return scene3d?.listener(focus) ?? null;
		const players = playerStates(current, tick).filter((p) => p.alive && p.present);
		const focused = focus !== null ? players.find((p) => p.index === focus) : undefined;
		if (focused) {
			const yaw = (focused.yaw * Math.PI) / 180;
			return {
				position: [focused.x, focused.y, focused.z + EAR_HEIGHT],
				forward: [Math.cos(yaw), Math.sin(yaw), 0],
				up: [0, 0, 1]
			};
		}
		if (!players.length) return null;
		const center = players.reduce(
			(sum, p) => [
				sum[0] + p.x / players.length,
				sum[1] + p.y / players.length,
				sum[2] + p.z / players.length
			],
			[0, 0, 0]
		);
		return { position: [center[0], center[1], center[2] + 600], forward: [0, 1, 0], up: [0, 0, 1] };
	}

	function savedGraphics(): GraphicsSettings {
		try {
			const saved = JSON.parse(
				localStorage.getItem(graphicsKey) ?? '{}'
			) as Partial<GraphicsSettings>;
			return {
				resolution:
					resolutions.find((r) => r.value === saved.resolution)?.value ??
					defaultGraphics.resolution,
				msaa: msaaOptions.find((m) => m.value === saved.msaa)?.value ?? defaultGraphics.msaa
			};
		} catch {
			return { ...defaultGraphics };
		}
	}

	function setGraphics(next: Partial<GraphicsSettings>) {
		graphics = { ...graphics, ...next };
		try {
			localStorage.setItem(graphicsKey, JSON.stringify(graphics));
		} catch {
			return;
		}
	}

	function perfRequested(): boolean {
		try {
			return new URLSearchParams(location.search).has('perf');
		} catch {
			return false;
		}
	}

	function togglePerf() {
		perfOpen = !perfOpen;
	}

	$effect(() => {
		profiler.setEnabled(perfOpen);
		if (!perfOpen) {
			bench?.cancel();
			bench = null;
			benchStatus = null;
		}
	});

	function startBench() {
		if (!scene3d || view !== '3d') {
			benchStatus = 'needs the 3D view';
			return;
		}
		profiler.clear();
		const run = new Benchmark(scene3d, $state.snapshot(graphics));
		const from = tick;
		const benchRound = round;
		run.onCase = () => {
			if (round === benchRound) tick = from;
			playing = true;
		};
		run.onProgress = (text) => {
			benchStatus = text;
			if (text === 'done') {
				saveReport('benchmark', run);
				bench = null;
			}
		};
		bench = run;
		if (!playing) playing = true;
	}

	function saveReport(kind: string, run: Benchmark | null = null) {
		const report = buildReport(kind, run);
		const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
		const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `cs-demo-cloud-perf-${kind}-${stamp}.json`;
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
	}

	function buildReport(kind: string, run: Benchmark | null) {
		const frames = profiler.frames.filter((f) => f.interval > 0);
		const nav = navigator as Navigator & { deviceMemory?: number };
		const memory = (
			performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
		).memory;
		return {
			kind,
			createdAt: new Date().toISOString(),
			browser: {
				userAgent: navigator.userAgent,
				platform: navigator.platform,
				cores: navigator.hardwareConcurrency,
				memoryGb: nav.deviceMemory ?? null,
				heapMb: memory ? Math.round(memory.usedJSHeapSize / 1e6) : null,
				screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio },
				gpuTimers: profiler.gpuAvailable
			},
			gpu: scene3d?.gpuName ?? null,
			viewer: {
				map,
				mapPack,
				playerPack,
				skinsPack,
				packState: packStatus.state,
				view,
				cameraMode,
				speed,
				playing,
				theater,
				fullscreen: Boolean(document.fullscreenElement),
				hud: hudOn,
				xray: xrayOn,
				textures: textureQuality,
				graphics: $state.snapshot(graphics),
				stage: { width: stageWidth, height: stageHeight, pixelRatio },
				drawing: scene3d?.drawingSize ?? null,
				renderScale: scene3d?.renderScale ?? null,
				scene: scene3d?.stats ?? null,
				round,
				tick: Math.round(tick)
			},
			replay: replay
				? {
						version: replay.meta.version,
						demoVersion: version,
						view: replay.meta.view ?? null,
						skins: replay.meta.skins?.length ?? 0,
						players: replay.meta.players.map((p) => ({
							name: p.name,
							agent: p.agent ?? null,
							crosshair: p.crosshair ?? null,
							viewmodel: p.viewmodel ?? null,
							gloves: p.gloves ?? null
						}))
					}
				: null,
			packs: scene3d?.packInfo ?? null,
			config: $state.snapshot(config),
			summary: summarize(frames),
			benchmark: run?.results ?? null,
			longFrames: profiler.longFrames,
			events: profiler.events,
			frames: frames.slice(-3600)
		};
	}

	function savedQuality(): TextureQuality {
		try {
			const saved = localStorage.getItem(qualityKey);
			return qualities.find((q) => q.value === saved)?.value ?? config.viewer.textures;
		} catch {
			return config.viewer.textures;
		}
	}

	function setQuality(next: TextureQuality) {
		textureQuality = next;
		try {
			localStorage.setItem(qualityKey, next);
		} catch {
			return;
		}
	}

	function setCameraMode(mode: CameraMode) {
		cameraMode = mode;
		if (mode === 'free' || !replay) return;
		const players = playerStates(replay, tick);
		if (focus === null || !players[focus]?.alive)
			focus = players.find((p) => p.alive && p.present)?.index ?? focus;
	}

	function cycleFocus(direction: 1 | -1) {
		if (!replay) return;
		const order = playerStates(replay, tick)
			.filter((p) => p.alive && p.present)
			.sort((a, b) => (a.side === b.side ? a.index - b.index : a.side === 'CT' ? -1 : 1));
		if (!order.length) return;
		const at = order.findIndex((p) => p.index === focus);
		const next = at < 0 ? 0 : (at + direction + order.length) % order.length;
		focus = order[next]!.index;
	}

	function startOf(next: RoundReplay): number {
		const { freezeEndTick, startTick, tickRate } = next.meta;
		return freezeEndTick
			? Math.max(startTick, freezeEndTick - config.viewer.leadIn * tickRate)
			: startTick;
	}

	function goToRound(number: number) {
		if (!rounds.some((r) => r.number === number) || number === round) return;
		loading = true;
		round = number;
	}

	$effect(() => {
		const number = round;
		loading = true;
		error = null;
		loadRound(demoId, version, number)
			.then((next) => {
				if (number !== round) return;
				replay = next;
				tick = hudTick = startOf(next);
				loading = false;
				if (rounds.some((r) => r.number === number + 1))
					loadRound(demoId, version, number + 1).catch(() => {});
			})
			.catch((cause: Error) => {
				if (number !== round) return;
				error = cause.message;
				loading = false;
				playing = false;
			});
	});

	$effect(() => {
		const name = map;
		const hasLower = mapInfo?.lowerBelowZ !== null && mapInfo !== null;
		radar = null;
		lowerRadar = null;
		const upper = new Image();
		upper.onload = () => (radar = upper);
		upper.src = `/maps/${name}.png`;
		if (hasLower) {
			const lower = new Image();
			lower.onload = () => (lowerRadar = lower);
			lower.src = `/maps/${name}_lower.png`;
		}
	});

	$effect(() => {
		if (view !== '3d' || !canvas3d || !overlay3d) return;
		const canvas = canvas3d;
		const overlay = overlay3d;
		let disposed = false;
		let created: ReplayScene | null = null;
		sceneError = null;
		import('./three/scene.ts')
			.then(({ ReplayScene }) => {
				if (disposed) return;
				created = new ReplayScene(canvas, overlay, { antialias: !mapPack });
				created.setGraphics($state.snapshot(graphics));
				created.onPick = (index) => (focus = focus === index ? null : index);
				created.onCycle = cycleFocus;
				created.onPackStatus = (status) => (packStatus = status);
				scene3d = created;
			})
			.catch((cause: Error) => {
				if (!disposed) sceneError = `3D view unavailable: ${cause.message}`;
			});
		return () => {
			disposed = true;
			created?.dispose();
			scene3d = null;
		};
	});

	$effect(() => {
		if (view !== '3d') return;
		const name = map;
		mesh = undefined;
		meshError = null;
		loadMapMesh(name)
			.then((loaded) => {
				if (name === map) mesh = loaded;
			})
			.catch((cause: Error) => {
				if (name !== map) return;
				meshError = cause.message;
				mesh = null;
			});
	});

	$effect(() => {
		if (!scene3d || mesh === undefined) return;
		scene3d.setMap(mapInfo, mesh, { upper: radar, lower: lowerRadar });
	});

	$effect(() => {
		scene3d?.setPack(map, mapPack, textureQuality);
	});

	$effect(() => {
		scene3d?.setPlayerPack(playerPack, textureQuality, skinsPack);
	});

	$effect(() => {
		const version = playerPack;
		if (!version) return;
		let current: ReplayAudio | null = null;
		let cancelled = false;
		void ReplayAudio.load(version)
			.then((loaded) => {
				if (cancelled) loaded?.dispose();
				else audio = current = loaded;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			current?.dispose();
			audio = null;
		};
	});

	$effect(() => {
		if (!perfRequested()) return;
		const controls = {
			state: () => ({ round, tick, focus, cameraMode, view, loading, playing }),
			round: (number: number) => goToRound(number),
			tick: (next: number) => (tick = next),
			focus: (index: number | null) => (focus = index),
			camera: (mode: CameraMode) => setCameraMode(mode),
			view: (next: '2d' | '3d') => setView(next),
			play: (on: boolean) => (playing = on),
			replay: () => replay
		};
		const target = window as unknown as { csdcViewer?: typeof controls };
		target.csdcViewer = controls;
		return () => {
			if (target.csdcViewer === controls) delete target.csdcViewer;
		};
	});

	$effect(() => {
		audio?.setVolume(config.audio.master, !soundOn || !config.audio.enabled);
	});

	$effect(() => {
		audio?.setConfig(config);
	});

	$effect(() => {
		scene3d?.setConfig(config);
	});

	$effect(() => {
		const next = $state.snapshot(graphics);
		if (!bench) untrack(() => scene3d)?.setGraphics(next);
	});

	$effect(() => {
		scene3d?.setSize(stageWidth, stageHeight, pixelRatio);
	});

	$effect(() => {
		pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		let frame = 0;
		let previous = performance.now();
		let lastHud = 0;
		let lastKey = '';
		let lastCanvas: HTMLCanvasElement | null = null;

		const loop = (now: number) => {
			profiler.beginFrame(now);
			bench?.step(now);
			const elapsed = Math.min(0.1, (now - previous) / 1000);
			previous = now;
			const current = replay;

			if (current && playing && !loading) {
				const last = lastTick(current);
				const next = tick + elapsed * current.meta.tickRate * speed;
				if (next >= last) {
					tick = last;
					if (config.viewer.autoAdvance && rounds.some((r) => r.number === round + 1))
						goToRound(round + 1);
					else playing = false;
				} else {
					tick = next;
				}
			}

			if (!playing || now - lastHud > 100) {
				if (hudTick !== tick) hudTick = tick;
				lastHud = now;
			}

			profiler.begin('audio');
			if (audio && current)
				audio.update(current, tick, playing && !loading, speed, listener(current));
			profiler.end('audio');

			if (view === '3d') {
				if (scene3d && current) {
					const drawn = scene3d.render({
						replay: current,
						tick,
						focus,
						mode: cameraMode,
						roofs,
						xray: xrayOn
					});
					scene3d.frameDone(now, drawn && playing);
					if (perfOpen && renderScale !== scene3d.renderScale) renderScale = scene3d.renderScale;
				}
			} else if (canvas && current) {
				const image = level === 'lower' && lowerRadar ? lowerRadar : radar;
				const key = `${tick}|${canvasPx}|${level}|${image?.src}|${current.meta.round}|${focus}`;
				if (key !== lastKey || canvas !== lastCanvas) {
					lastKey = key;
					lastCanvas = canvas;
					const ctx = canvas.getContext('2d');
					if (ctx)
						drawFrame({
							ctx,
							size: canvasPx,
							pixelRatio,
							replay: current,
							tick,
							map: mapInfo,
							radar: image,
							level,
							focus
						});
				}
			}

			profiler.endFrame();
			frame = requestAnimationFrame(loop);
		};

		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	function seek(seconds: number) {
		if (!replay) return;
		tick = Math.max(replay.meta.startTick, Math.min(end, tick + seconds * replay.meta.tickRate));
	}

	function onKey(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
		if (event.key === ' ') playing = !playing;
		else if (event.key === 'ArrowLeft') seek(event.shiftKey ? -1 : -5);
		else if (event.key === 'ArrowRight') seek(event.shiftKey ? 1 : 5);
		else if (event.key === 'PageUp' || event.key === '[') goToRound(round - 1);
		else if (event.key === 'PageDown' || event.key === ']') goToRound(round + 1);
		else if (/^[1-5]$/.test(event.key)) speed = speeds[Number(event.key) - 1]!;
		else if (event.key === 'm' || event.key === 'M') toggleSound();
		else if (event.key === 'f' || event.key === 'F') setTheater(!theater);
		else if (event.key === 'h' || event.key === 'H') toggleHud();
		else if (event.key === 'p' || event.key === 'P') togglePerf();
		else if ((event.key === 'x' || event.key === 'X') && view === '3d') toggleXray();
		else if (event.key === 'Escape' && theater) setTheater(false);
		else if (event.key === 'v' || event.key === 'V') setView(view === '3d' ? '2d' : '3d');
		else if ((event.key === 'c' || event.key === 'C') && view === '3d') {
			const index = cameraModes.findIndex((option) => option.mode === cameraMode);
			setCameraMode(cameraModes[(index + 1) % cameraModes.length]!.mode);
		} else return;
		event.preventDefault();
	}

	const clock = $derived.by(() => {
		if (!replay) return { label: '', time: '', bomb: false };
		const { meta } = replay;
		const rate = meta.tickRate;
		const bomb = bombState(replay, hudTick);
		if (hudTick >= meta.endTick) {
			const winner = meta.winner ? `${meta.winner} win` : 'Round over';
			return { label: winner, time: reasonText(meta.reason), bomb: false };
		}
		if (bomb?.kind === 'planted') {
			return {
				label: `Bomb ${bomb.site ?? ''}`.trim(),
				time: formatClock(BOMB_SECONDS - (hudTick - bomb.tick) / rate),
				bomb: true
			};
		}
		if (meta.freezeEndTick && hudTick < meta.freezeEndTick) {
			return {
				label: 'Freeze time',
				time: formatClock((meta.freezeEndTick - hudTick) / rate),
				bomb: false
			};
		}
		const live = meta.freezeEndTick ?? meta.startTick;
		return {
			label: `Round ${meta.round}`,
			time: formatClock(ROUND_SECONDS - (hudTick - live) / rate),
			bomb: false
		};
	});

	const killFeed = $derived.by(() => {
		if (!replay) return [];
		const window = 6 * replay.meta.tickRate;
		return replay.meta.kills
			.filter((kill) => kill.tick <= hudTick && hudTick - kill.tick < window)
			.slice(-5);
	});

	const reasons: Record<string, string> = {
		bomb_exploded: 'Bomb exploded',
		bomb_defused: 'Bomb defused',
		t_killed: 'Terrorists eliminated',
		ct_killed: 'CTs eliminated',
		target_saved: 'Time ran out',
		t_surrender: 'Terrorists surrendered',
		ct_surrender: 'CTs surrendered'
	};
	const reasonText = (reason: string | null) =>
		reason ? (reasons[reason] ?? reason.replace(/_/g, ' ')) : '';

	const teamSide = (team: TeamKey): Side | null => {
		if (!roundInfo) return null;
		return team === 'a' ? roundInfo.teamASide : roundInfo.teamASide === 'CT' ? 'T' : 'CT';
	};

	const hudSides = $derived({ a: teamSide('a'), b: teamSide('b') });
	const hudScores = $derived({ a: previousRound?.scoreA ?? 0, b: previousRound?.scoreB ?? 0 });

	const marker = (value: number) =>
		replay ? ((value - replay.meta.startTick) / Math.max(1, end - replay.meta.startTick)) * 100 : 0;
	const halfBreak = (number: number) => number === 12 || (number > 24 && (number - 24) % 3 === 0);
</script>

<svelte:window
	bind:innerHeight
	bind:innerWidth
	onkeydown={(event) => {
		if (soundOn) audio?.unlock();
		onKey(event);
	}}
	onpointerdown={() => {
		if (soundOn) audio?.unlock();
	}}
	onpointermove={() => {
		if (theater) wake();
	}}
/>

<svelte:document
	onfullscreenchange={() => {
		if (!document.fullscreenElement && theater) theater = false;
	}}
/>

<div class="viewer" class:theater>
	{#each teamKeys as team (team)}
		{@const side = teamSide(team)}
		<aside class="team {team}" style:--side={side ? sideColors[side] : 'var(--muted)'}>
			<header>
				<span class="team-name">{teamNames[team]}</span>
				<span class="team-score"
					>{team === 'a' ? (previousRound?.scoreA ?? 0) : (previousRound?.scoreB ?? 0)}</span
				>
				{#if side}<span class="side">{side}</span>{/if}
			</header>
			<ul>
				{#each hudPlayers.filter((p) => p.team === team) as player (player.steamid)}
					<li class:dead={!player.alive} class:focused={focus === player.index}>
						<button
							type="button"
							onclick={() => (focus = focus === player.index ? null : player.index)}
						>
							<span class="row">
								<span class="name">{player.name}</span>
								<span class="money">${player.money}</span>
							</span>
							<span class="bar"
								><span style:width="{player.alive ? player.health : 0}%"></span></span
							>
							<span class="row small">
								<span class="hp">{player.alive ? player.health : 0}</span>
								<span class="weapon">{player.alive ? weaponTitle(player.weapon) : 'Dead'}</span>
								<span class="badges">
									{#if player.bomb}<span class="badge bomb">C4</span>{/if}
									{#if player.defuser}<span class="badge">Kit</span>{/if}
									{#if player.armor > 0}<span class="badge">{player.helmet ? 'A+H' : 'A'}</span
										>{/if}
									{#if player.kills > 0}<span class="badge kills">{player.kills}K</span>{/if}
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</aside>
	{/each}

	<div class="stage" bind:clientWidth={wrapWidth}>
		{#if view === '2d' || !hudOn}
			<div class="clock" class:bomb={clock.bomb}>
				<span class="label">{clock.label}</span>
				<span class="time">{clock.time}</span>
			</div>
		{/if}
		<div class="canvas-wrap" class:idle style:width="{stageWidth}px" style:height="{stageHeight}px">
			{#if view === '3d'}
				<canvas
					bind:this={canvas3d}
					class="scene"
					style:width="{stageWidth}px"
					style:height="{stageHeight}px"
				></canvas>
				<canvas
					bind:this={overlay3d}
					class="overlay"
					style:width="{stageWidth}px"
					style:height="{stageHeight}px"
				></canvas>
				{#if hudOn && replay}
					<GameHud
						{replay}
						tick={hudTick}
						players={hudPlayers}
						{focus}
						pov={cameraMode === 'pov'}
						{teamNames}
						teamSides={hudSides}
						scores={hudScores}
						{clock}
						map={mapInfo}
						{radar}
						{lowerRadar}
						{pixelRatio}
						height={stageHeight}
						onSelect={(index) => (focus = focus === index ? null : index)}
					/>
				{/if}
				{#if perfOpen}
					<PerfPanel
						{benchStatus}
						scale={renderScale}
						onBench={startBench}
						onSave={(kind) => saveReport(kind)}
						onClose={() => (perfOpen = false)}
					/>
				{/if}
			{:else}
				<canvas
					bind:this={canvas}
					width={canvasPx}
					height={canvasPx}
					style:width="{cssSize}px"
					style:height="{cssSize}px"
				></canvas>
			{/if}
			{#if loading}<div class="notice">Loading round {round}…</div>{/if}
			{#if error}<div class="notice error">{error}</div>{/if}
			{#if view === '2d' && !radar && !loading}
				<div class="notice faint">No radar image for {map}</div>
			{/if}
			{#if view === '3d' && !loading && !error}
				{#if sceneError}
					<div class="notice error">{sceneError}</div>
				{:else if packStatus.state === 'loading'}
					<div class="notice" class:faint={packStatus.progress?.preview}>
						{packStatus.progress?.preview
							? 'Sharpening textures'
							: 'Loading textured map'}{packStatus.progress?.textures
							? ` · ${packStatus.progress.texturesLoaded}/${packStatus.progress.textures}`
							: '…'}
					</div>
				{:else if packStatus.state === 'error'}
					<div class="notice error">{packStatus.message}</div>
				{:else if packStatus.state === 'none'}
					{#if meshError}
						<div class="notice error">{meshError}</div>
					{:else if mesh === undefined}
						<div class="notice">Loading 3D map…</div>
					{:else if mesh === null}
						<div class="notice faint">
							No 3D map for {map} yet. The worker downloads it the next time it starts.
						</div>
					{/if}
				{/if}
			{/if}
			{#if view === '2d' || !hudOn}
				<ol class="killfeed">
					{#each killFeed as kill (kill.tick + ':' + kill.victim)}
						{@const attacker = replay?.meta.players[kill.attacker]}
						{@const victim = replay?.meta.players[kill.victim]}
						<li>
							{#if attacker && kill.attacker !== kill.victim}
								<span style:color={sideColors[attacker.side]}>{attacker.name}</span>
							{/if}
							<span class="kill-weapon">
								{weaponTitle(kill.weapon)}{kill.headshot ? ' · HS' : ''}{kill.wallbang
									? ' · wall'
									: ''}{kill.throughSmoke ? ' · smoke' : ''}
							</span>
							{#if victim}<span style:color={sideColors[victim.side]}>{victim.name}</span>{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>

		<div class="controls" class:idle>
			<div class="timeline">
				{#if replay}
					{#if replay.meta.freezeEndTick}
						<span class="mark freeze" style:left="{marker(replay.meta.freezeEndTick)}%"></span>
					{/if}
					{#each replay.meta.kills as kill (kill.tick + ':' + kill.victim)}
						{@const attacker = replay.meta.players[kill.attacker]}
						<span
							class="mark kill"
							style:left="{marker(kill.tick)}%"
							style:background={attacker ? sideColors[attacker.side] : 'var(--muted)'}
						></span>
					{/each}
					{#each replay.meta.bomb.filter((b) => b.type === 'plant') as plant (plant.tick)}
						<span class="mark plant" style:left="{marker(plant.tick)}%"></span>
					{/each}
				{/if}
				<input
					type="range"
					min={replay?.meta.startTick ?? 0}
					max={end}
					step="1"
					value={tick}
					oninput={(event) => (tick = Number(event.currentTarget.value))}
					aria-label="Round timeline"
				/>
			</div>
			<div class="buttons">
				<button
					type="button"
					class="icon"
					onclick={() => goToRound(round - 1)}
					disabled={round <= 1}
					aria-label="Previous round">‹‹</button
				>
				<button type="button" class="play" onclick={() => (playing = !playing)} disabled={!replay}>
					{playing ? 'Pause' : 'Play'}
				</button>
				<button
					type="button"
					class="icon"
					onclick={() => goToRound(round + 1)}
					disabled={round >= rounds.length}
					aria-label="Next round">››</button
				>
				<span class="round-label">Round {round}</span>
				<select bind:value={speed} aria-label="Playback speed">
					{#each speeds as option (option)}
						<option value={option}>{option}×</option>
					{/each}
				</select>
				{#if audio && config.audio.enabled}
					<button
						type="button"
						class="sound"
						aria-pressed={soundOn}
						onclick={toggleSound}
						title="Sound (M)">{soundOn ? 'Sound on' : 'Sound off'}</button
					>
				{/if}
				<span class="spacer"></span>
				{#if view === '3d'}
					<div class="segmented" role="group" aria-label="Camera">
						{#each cameraModes as option (option.mode)}
							<button
								type="button"
								class:active={cameraMode === option.mode}
								aria-pressed={cameraMode === option.mode}
								onclick={() => setCameraMode(option.mode)}>{option.label}</button
							>
						{/each}
					</div>
					<button
						type="button"
						class:active={!roofs}
						aria-pressed={!roofs}
						title="Hide everything above the players"
						onclick={() => (roofs = !roofs)}>Cut roofs</button
					>
					<button type="button" onclick={() => scene3d?.resetView()}>Reset</button>
					{#if mapPack}
						<select
							aria-label="Texture quality"
							value={textureQuality}
							onchange={(e) => setQuality(e.currentTarget.value as TextureQuality)}
						>
							{#each qualities as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
						<select
							aria-label="Render resolution"
							value={String(graphics.resolution)}
							onchange={(e) => {
								const value = e.currentTarget.value;
								setGraphics({
									resolution: value === 'auto' ? 'auto' : (Number(value) as Resolution)
								});
							}}
						>
							{#each resolutions as option (option.value)}
								<option value={String(option.value)}>{option.label}</option>
							{/each}
						</select>
						<select
							aria-label="Anti-aliasing"
							value={String(graphics.msaa)}
							onchange={(e) =>
								setGraphics({ msaa: Number(e.currentTarget.value) as GraphicsSettings['msaa'] })}
						>
							{#each msaaOptions as option (option.value)}
								<option value={String(option.value)}>{option.label}</option>
							{/each}
						</select>
					{/if}
					<button
						type="button"
						class:active={perfOpen}
						aria-pressed={perfOpen}
						title="Performance stats and reports (P)"
						onclick={togglePerf}>Stats</button
					>
					<button
						type="button"
						class:active={xrayOn}
						aria-pressed={xrayOn}
						title="Show players through walls (X)"
						onclick={toggleXray}>X-ray</button
					>
					<button
						type="button"
						class:active={hudOn}
						aria-pressed={hudOn}
						title="Game HUD (H)"
						onclick={toggleHud}>HUD</button
					>
					<button
						type="button"
						class:active={theater}
						aria-pressed={theater}
						title="Full screen (F)"
						onclick={() => setTheater(!theater)}
						>{theater ? 'Exit full screen' : 'Full screen'}</button
					>
				{/if}
				<div class="segmented" role="group" aria-label="View">
					<button
						type="button"
						class:active={view === '2d'}
						aria-pressed={view === '2d'}
						onclick={() => setView('2d')}>2D</button
					>
					<button
						type="button"
						class:active={view === '3d'}
						aria-pressed={view === '3d'}
						onclick={() => setView('3d')}>3D</button
					>
				</div>
				{#if view === '2d' && mapInfo?.lowerBelowZ !== null && mapInfo}
					<button
						type="button"
						class="level"
						onclick={() => (level = level === 'upper' ? 'lower' : 'upper')}
					>
						{level === 'upper' ? 'Upper' : 'Lower'}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<nav class="rounds" aria-label="Rounds">
	{#each rounds as info (info.number)}
		<button
			type="button"
			class:current={info.number === round}
			style:--win={info.winnerSide ? sideColors[info.winnerSide] : 'var(--muted)'}
			title="Round {info.number}: {info.winnerSide ?? '?'} · {reasonText(
				info.reason
			)} ({info.scoreA}:{info.scoreB})"
			onclick={() => goToRound(info.number)}
		>
			{info.number}
		</button>
		{#if halfBreak(info.number) && info.number !== rounds.length}<span class="half"></span>{/if}
	{/each}
</nav>
<p class="hint">
	Space play/pause · ←/→ 5 s (Shift 1 s) · [ / ] round · 1–5 speed · V 2D/3D · click a player to
	highlight
	{#if view === '3d'}
		<br />3D: drag to pan · right-drag or Shift-drag to rotate · scroll to zoom · C camera mode · F
		full screen · H HUD · X x-ray · in Follow and POV, left/right click switches to the
		next/previous player
	{/if}
</p>

<style>
	.viewer {
		display: grid;
		grid-template-columns: 230px minmax(0, 1fr) 230px;
		grid-template-areas: 'a stage b';
		gap: 16px;
		align-items: start;
	}

	.team.a {
		grid-area: a;
	}

	.team.b {
		grid-area: b;
	}

	.stage {
		grid-area: stage;
		display: grid;
		justify-items: center;
		gap: 10px;
		min-width: 0;
	}

	@media (max-width: 980px) {
		.viewer {
			grid-template-columns: 1fr 1fr;
			grid-template-areas: 'stage stage' 'a b';
		}
	}

	@media (max-width: 560px) {
		.viewer {
			grid-template-columns: 1fr;
			grid-template-areas: 'stage' 'a' 'b';
		}
	}

	.team header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 0 4px 8px;
		border-bottom: 2px solid var(--side);
		margin-bottom: 6px;
	}

	.team-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 650;
	}

	.team-score {
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.side {
		color: var(--side);
		font-size: 12px;
		font-weight: 700;
	}

	.team ul {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.team li button {
		display: grid;
		gap: 4px;
		width: 100%;
		padding: 7px 8px;
		border: 1px solid transparent;
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.team li.focused button {
		border-color: var(--side);
	}

	.team li.dead button {
		opacity: 0.45;
	}

	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px;
		min-width: 0;
	}

	.row.small {
		font-size: 12px;
		color: var(--muted);
	}

	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13.5px;
		font-weight: 600;
	}

	.money {
		color: #8fd18f;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.bar {
		height: 4px;
		border-radius: 2px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		background: var(--side);
	}

	.hp {
		width: 26px;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.weapon {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badges {
		display: flex;
		gap: 3px;
	}

	.badge {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--surface-2);
		font-size: 10.5px;
		font-weight: 650;
		color: var(--text);
	}

	.badge.bomb {
		background: #ef4b4b;
	}

	.badge.kills {
		color: var(--accent);
	}

	.clock {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-variant-numeric: tabular-nums;
	}

	.clock .label {
		color: var(--muted);
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.clock .time {
		font-size: 22px;
		font-weight: 700;
	}

	.clock.bomb .label,
	.clock.bomb .time {
		color: #ef4b4b;
	}

	.canvas-wrap {
		position: relative;
		border-radius: var(--radius);
		overflow: hidden;
		background: #0b0d10;
	}

	canvas {
		display: block;
	}

	canvas.overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.segmented {
		display: flex;
	}

	.segmented button + button {
		margin-left: -1px;
	}

	.notice {
		position: absolute;
		left: 12px;
		bottom: 12px;
		padding: 4px 10px;
		border-radius: 6px;
		background: rgb(0 0 0 / 0.6);
		font-size: 13px;
	}

	.notice.error {
		color: var(--danger);
	}

	.notice.faint {
		color: var(--muted);
	}

	.killfeed {
		position: absolute;
		top: 10px;
		right: 10px;
		display: grid;
		justify-items: end;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
		pointer-events: none;
	}

	.killfeed li {
		display: flex;
		gap: 8px;
		padding: 3px 9px;
		border-radius: 6px;
		background: rgb(0 0 0 / 0.68);
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
	}

	.kill-weapon {
		color: #d7dbe0;
		font-weight: 500;
	}

	.controls {
		display: grid;
		gap: 6px;
		width: 100%;
		max-width: 1100px;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.spacer {
		flex: 1;
	}

	.round-label {
		color: var(--muted);
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.controls button.active {
		border-color: var(--accent);
		color: var(--accent);
	}

	.viewer.theater {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: block;
		background: #000;
	}

	.viewer.theater .team {
		display: none;
	}

	.viewer.theater .stage {
		position: absolute;
		inset: 0;
		display: block;
	}

	.viewer.theater .canvas-wrap {
		border-radius: 0;
	}

	.canvas-wrap.idle {
		cursor: none;
	}

	.viewer.theater .controls {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		max-width: none;
		padding: 36px 16px 12px;
		background: linear-gradient(rgb(0 0 0 / 0), rgb(0 0 0 / 0.8));
		transition: opacity 0.3s;
	}

	.viewer.theater .controls.idle {
		opacity: 0;
	}

	.controls button,
	.controls select {
		height: 34px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.controls button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.controls .segmented button {
		padding: 0 10px;
		border-radius: 0;
	}

	.controls .segmented button:first-child {
		border-radius: 8px 0 0 8px;
	}

	.controls .segmented button:last-child {
		border-radius: 0 8px 8px 0;
	}

	.controls .segmented button.active {
		background: var(--surface-2);
		color: var(--accent);
	}

	.controls .play {
		min-width: 72px;
		background: var(--accent);
		border-color: var(--accent);
		color: #1a1206;
	}

	.timeline {
		position: relative;
		flex: 1;
		display: flex;
		align-items: center;
		height: 34px;
	}

	.timeline input {
		position: relative;
		width: 100%;
		margin: 0;
		accent-color: var(--accent);
	}

	.mark {
		position: absolute;
		top: 4px;
		width: 3px;
		height: 8px;
		border-radius: 1px;
		transform: translateX(-50%);
	}

	.mark.freeze {
		background: var(--muted);
	}

	.mark.plant {
		top: auto;
		bottom: 4px;
		background: #ef4b4b;
	}

	.rounds {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 18px;
	}

	.rounds button {
		width: 34px;
		padding: 5px 0 7px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: 12px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		box-shadow: inset 0 -3px 0 var(--win);
	}

	.rounds button.current {
		border-color: var(--accent);
	}

	.half {
		width: 10px;
	}

	.hint {
		margin: 10px 0 0;
		color: var(--muted);
		font-size: 12.5px;
	}
</style>
