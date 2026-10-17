import {
	FLAG_ALIVE,
	FLAG_SCOPED,
	weaponKey,
	type PlayerPackManifest,
	type PlayerPackSound,
	type RoundReplay,
	type Side
} from '@cs-demo-cloud/replay';

const BASE = '/maps/3d/players';
const STRIDE = 76;
const RUNNING = 150;
const LANDING = -260;
const MAX_VOICES = 28;
const MAX_GAP_SECONDS = 0.75;
const ROUND_SECONDS = 115;
const BOMB_SECONDS = 40;
const MUSIC_VOLUME = 0.45;
const RADIO_VOLUME = 0.9;
const SNIPERS = new Set(['awp', 'ssg08', 'scar20', 'g3sg1']);
const SCOPED_RIFLES = new Set(['aug', 'sg556']);
export const EAR_HEIGHT = 64;

export interface Listener {
	position: [number, number, number];
	forward: [number, number, number];
	up: [number, number, number];
	player?: number | null;
	side?: Side | null;
}

interface Cue {
	tick: number;
	key: string;
	x: number;
	y: number;
	z: number;
	priority: number;
	owner?: number;
	global?: 'music' | 'radio';
}

interface Voice {
	source: AudioBufferSourceNode;
	priority: number;
}

interface Loop {
	source: AudioBufferSourceNode;
	gain: GainNode;
	panner: PannerNode;
	sound: PlayerPackSound;
	x: number;
	y: number;
	z: number;
}

const cueCache = new WeakMap<RoundReplay, Cue[]>();

function frameIndex(replay: RoundReplay, player: number, tick: number): number {
	const { meta } = replay;
	const i = Math.round((tick - meta.startTick) / meta.tickStep);
	return player * meta.frameCount + Math.max(0, Math.min(meta.frameCount - 1, i));
}

function bounces(path: number[]): number[] {
	const out: number[] = [];
	const points = path.length / 4;
	for (let i = 1; i < points - 1; i++) {
		const t0 = path[(i - 1) * 4]!;
		const t1 = path[i * 4]!;
		const t2 = path[(i + 1) * 4]!;
		if (t1 <= t0 || t2 <= t1) continue;
		const before = (path[i * 4 + 3]! - path[(i - 1) * 4 + 3]!) / (t1 - t0);
		const after = (path[(i + 1) * 4 + 3]! - path[i * 4 + 3]!) / (t2 - t1);
		const turn =
			Math.sign(path[i * 4 + 1]! - path[(i - 1) * 4 + 1]!) !==
				Math.sign(path[(i + 1) * 4 + 1]! - path[i * 4 + 1]!) ||
			Math.sign(path[i * 4 + 2]! - path[(i - 1) * 4 + 2]!) !==
				Math.sign(path[(i + 1) * 4 + 2]! - path[i * 4 + 2]!);
		if ((before < -0.5 && after > 0.2) || (turn && Math.abs(before) < 40)) out.push(i);
	}
	return out;
}

export function soundCues(replay: RoundReplay): Cue[] {
	const cached = cueCache.get(replay);
	if (cached) return cached;
	const { meta, columns } = replay;
	const cues: Cue[] = [];
	const add = (tick: number, key: string, x: number, y: number, z: number, priority = 1) =>
		cues.push({ tick, key, x, y, z, priority });
	const own = (tick: number, key: string, owner: number) =>
		cues.push({ tick, key, x: 0, y: 0, z: 0, priority: 2, owner });
	const announce = (tick: number, key: string, global: 'music' | 'radio') =>
		cues.push({ tick, key, x: 0, y: 0, z: 0, priority: 4, global });

	const hurts = meta.hurts ?? [];
	for (let i = 0; i + 5 < hurts.length; i += 6) {
		const [tick, victim, , , armor, head] = hurts.slice(i, i + 6) as number[];
		const f = frameIndex(replay, victim!, tick!);
		const key = head
			? armor! > 0
				? 'hit:helmet'
				: 'hit:head'
			: armor! > 0
				? 'hit:kevlar'
				: 'hit:body';
		add(tick!, key, columns.x[f]!, columns.y[f]!, columns.z[f]! + (head ? 62 : 44), 2);
	}

	const live = meta.freezeEndTick ?? meta.startTick;
	const plant = meta.bomb.find((event) => event.type === 'plant');
	const finish = meta.bomb.find((event) => event.type === 'defuse' || event.type === 'explode');
	announce(meta.startTick, 'music:start', 'music');
	if (meta.freezeEndTick) announce(meta.freezeEndTick, 'music:action', 'music');
	const roundTen = live + (ROUND_SECONDS - 10) * meta.tickRate;
	if (!plant || plant.tick > roundTen) announce(roundTen, 'music:round10', 'music');
	if (plant) {
		announce(plant.tick, 'radio:bombpl', 'radio');
		announce(plant.tick, 'music:bomb', 'music');
		const bombTen = plant.tick + (BOMB_SECONDS - 10) * meta.tickRate;
		if (!finish || finish.tick > bombTen) announce(bombTen, 'music:bomb10', 'music');
	}
	if (finish?.type === 'defuse') announce(finish.tick, 'radio:bombdef', 'radio');
	if (meta.endTick) {
		const radio =
			meta.winner === 'CT'
				? 'radio:ctwin'
				: meta.winner === 'T'
					? 'radio:terwin'
					: 'radio:rounddraw';
		announce(meta.endTick + (finish?.type === 'defuse' ? meta.tickRate : 0), radio, 'radio');
		announce(meta.endTick, 'music:end', 'music');
	}

	for (let i = 0; i < meta.shots.length; i += 2) {
		const tick = meta.shots[i]!;
		const player = meta.shots[i + 1]!;
		const f = frameIndex(replay, player, tick);
		const weapon = weaponKey(meta.weapons[columns.weapon[f]!] ?? '');
		if (!weapon) continue;
		const [x, y, z] = [columns.x[f]!, columns.y[f]!, columns.z[f]! + 60];
		add(tick, `shot:${weapon}`, x, y, z, 3);
		add(tick, `far:${weapon}`, x, y, z, 2);
	}

	for (const kill of meta.kills) {
		add(kill.tick, kill.headshot ? 'kill:head' : 'kill:body', kill.x, kill.y, kill.z + 50, 3);
		add(kill.tick + 2, 'death', kill.x, kill.y, kill.z + 50, 2);
	}

	for (const effect of meta.effects) {
		const { startTick: tick, x, y, z } = effect;
		if (effect.type === 'smoke') add(tick, 'smoke', x, y, z, 2);
		else if (effect.type === 'flash') {
			add(tick, 'flash', x, y, z, 3);
			add(tick, 'flash:far', x, y, z, 2);
		} else if (effect.type === 'he') {
			add(tick, 'he', x, y, z, 3);
			add(tick, 'he:far', x, y, z, 2);
		} else if (effect.type === 'molotov') add(tick, 'molotov', x, y, z, 3);
	}

	for (const grenade of meta.grenades) {
		const type = grenade.type === 'molotov' ? 'molotov' : grenade.type;
		for (const i of bounces(grenade.path)) {
			const p = grenade.path;
			add(p[i * 4]!, `bounce:${type}`, p[i * 4 + 1]!, p[i * 4 + 2]!, p[i * 4 + 3]!, 1);
		}
	}

	let planted: { tick: number; x: number; y: number; z: number } | null = null;
	let stopped = Infinity;
	for (const event of meta.bomb) {
		if (event.type === 'plant') {
			planted = event;
			add(event.tick, 'bomb:plant', event.x, event.y, event.z, 3);
		} else if (event.type === 'defuse_start') {
			add(event.tick, 'bomb:defuse_start', event.x, event.y, event.z, 2);
		} else if (event.type === 'defuse') {
			add(event.tick, 'bomb:defused', event.x, event.y, event.z, 3);
			stopped = Math.min(stopped, event.tick);
		} else if (event.type === 'explode') {
			add(event.tick, 'bomb:explode', event.x, event.y, event.z, 3);
			stopped = Math.min(stopped, event.tick);
		}
	}
	if (planted) {
		const end = Math.min(stopped, meta.endTick, planted.tick + 40 * meta.tickRate);
		let t = planted.tick + meta.tickRate;
		while (t < end) {
			add(Math.round(t), 'bomb:beep', planted.x, planted.y, planted.z + 10, 2);
			const left = Math.max(0, (planted.tick + 40 * meta.tickRate - t) / meta.tickRate);
			t += Math.max(0.12, Math.min(1, 0.1 + left / 40)) * meta.tickRate;
		}
	}

	const n = meta.frameCount;
	const step = meta.tickStep;
	meta.players.forEach((_, p) => {
		for (let i = 1; i < n; i++) {
			const a = p * n + i - 1;
			const b = a + 1;
			if (!(columns.flags[b]! & FLAG_ALIVE)) continue;
			const tick = meta.startTick + i * step;
			const key = weaponKey(meta.weapons[columns.weapon[b]!] ?? '');
			if (columns.weapon[b] !== columns.weapon[a] && key) own(tick, `draw:${key}`, p);
			if (columns.flags[b]! & FLAG_SCOPED && !(columns.flags[a]! & FLAG_SCOPED) && key) {
				if (SNIPERS.has(key)) own(tick, 'zoom:sniper', p);
				else if (SCOPED_RIFLES.has(key)) own(tick, 'zoom:rifle', p);
			}
		}
	});
	meta.players.forEach((player, p) => {
		let travelled = 0;
		let next = STRIDE;
		let falling = 0;
		for (let i = 1; i < n; i++) {
			const a = p * n + i - 1;
			const b = a + 1;
			if (!(columns.flags[b]! & FLAG_ALIVE)) {
				falling = 0;
				continue;
			}
			const dx = columns.x[b]! - columns.x[a]!;
			const dy = columns.y[b]! - columns.y[a]!;
			const dz = columns.z[b]! - columns.z[a]!;
			const seconds = step / meta.tickRate;
			const speed = Math.hypot(dx, dy) / seconds;
			const vertical = dz / seconds;
			const tick = meta.startTick + i * step;
			if (falling < LANDING && vertical > -40) {
				add(tick, 'land', columns.x[b]!, columns.y[b]!, columns.z[b]! + 4, 1);
				next = travelled + STRIDE;
			}
			falling = vertical;
			if (speed > 600) continue;
			travelled += Math.hypot(dx, dy);
			if (speed < RUNNING || Math.abs(vertical) > 120) {
				next = travelled + STRIDE / 2;
				continue;
			}
			while (travelled >= next) {
				add(tick, `step:${player.side}`, columns.x[b]!, columns.y[b]!, columns.z[b]! + 4, 1);
				next += STRIDE;
			}
		}
	});

	cues.sort((a, b) => a.tick - b.tick);
	cueCache.set(replay, cues);
	return cues;
}

function curveGain(curve: number[], distance: number): number {
	if (curve.length < 4) return 1;
	if (distance <= curve[0]!) return curve[1]!;
	for (let i = 2; i < curve.length; i += 2) {
		const d1 = curve[i]!;
		if (distance <= d1) {
			const d0 = curve[i - 2]!;
			const t = d1 > d0 ? (distance - d0) / (d1 - d0) : 1;
			return curve[i - 1]! + (curve[i + 1]! - curve[i - 1]!) * t;
		}
	}
	return curve[curve.length - 1]!;
}

export class ReplayAudio {
	private sounds: Record<string, PlayerPackSound>;
	private version: string;
	private context: AudioContext | null = null;
	private master: GainNode | null = null;
	private buffers = new Map<string, Promise<AudioBuffer | null>>();
	private voices: Voice[] = [];
	private loops = new Map<string, Loop>();
	private lastTick: number | null = null;
	private lastReplay: RoundReplay | null = null;
	private volume = 0.7;
	private muted = false;
	private listener: Listener | null = null;
	private music: AudioBufferSourceNode | null = null;

	constructor(manifest: PlayerPackManifest, version: string) {
		this.sounds = manifest.sounds ?? {};
		this.version = version;
	}

	static async load(version: string): Promise<ReplayAudio | null> {
		const response = await fetch(`${BASE}/players.json?v=${version}`);
		if (!response.ok) return null;
		const manifest = (await response.json()) as PlayerPackManifest;
		return manifest.sounds && Object.keys(manifest.sounds).length
			? new ReplayAudio(manifest, version)
			: null;
	}

	unlock() {
		if (!this.context) {
			const context = new AudioContext();
			this.master = context.createGain();
			this.master.gain.value = this.muted ? 0 : this.volume;
			this.master.connect(context.destination);
			this.context = context;
			for (const key of ['shot:ak47', 'shot:m4a1_silencer', 'step:CT', 'step:T']) this.preload(key);
		}
		if (this.context.state === 'suspended') void this.context.resume();
	}

	setVolume(volume: number, muted: boolean) {
		this.volume = volume;
		this.muted = muted;
		if (this.master && this.context)
			this.master.gain.setTargetAtTime(muted ? 0 : volume, this.context.currentTime, 0.03);
	}

	update(
		replay: RoundReplay,
		tick: number,
		playing: boolean,
		speed: number,
		listener: Listener | null
	) {
		this.listener = listener;
		const context = this.context;
		if (!context || context.state !== 'running' || !listener) {
			this.lastTick = tick;
			this.lastReplay = replay;
			return;
		}
		this.placeListener(context, listener);

		const previous = this.lastTick;
		const continuous =
			playing &&
			replay === this.lastReplay &&
			previous !== null &&
			tick > previous &&
			tick - previous < MAX_GAP_SECONDS * replay.meta.tickRate * Math.max(1, speed);
		this.lastTick = tick;
		this.lastReplay = replay;
		if (!continuous) this.stopMusic();

		if (continuous) {
			const cues = soundCues(replay);
			let lo = 0;
			let hi = cues.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (cues[mid]!.tick <= previous) lo = mid + 1;
				else hi = mid;
			}
			for (let i = lo; i < cues.length && cues[i]!.tick <= tick; i++) {
				const cue = cues[i]!;
				if (speed > 2 && cue.priority < 2) continue;
				if (cue.owner !== undefined && cue.owner !== listener.player) continue;
				if (cue.global) {
					if (speed > 2) continue;
					this.announce(cue, replay);
				} else if (cue.owner !== undefined) this.announce(cue, replay);
				else this.play(cue, speed);
			}
		}
		this.updateLoops(replay, tick, playing && speed <= 4);
	}

	private placeListener(context: AudioContext, listener: Listener) {
		const l = context.listener;
		const [x, y, z] = listener.position;
		const [fx, fy, fz] = listener.forward;
		const [ux, uy, uz] = listener.up;
		if (l.positionX) {
			l.positionX.value = x;
			l.positionY.value = y;
			l.positionZ.value = z;
			l.forwardX.value = fx;
			l.forwardY.value = fy;
			l.forwardZ.value = fz;
			l.upX.value = ux;
			l.upY.value = uy;
			l.upZ.value = uz;
		} else {
			l.setPosition(x, y, z);
			l.setOrientation(fx, fy, fz, ux, uy, uz);
		}
	}

	private distance(x: number, y: number, z: number): number {
		const [lx, ly, lz] = this.listener!.position;
		return Math.hypot(x - lx, y - ly, z - lz);
	}

	private preload(key: string) {
		for (const file of this.sounds[key]?.files ?? []) void this.buffer(file);
	}

	private buffer(file: string): Promise<AudioBuffer | null> {
		let promise = this.buffers.get(file);
		if (!promise) {
			const context = this.context!;
			promise = fetch(`${BASE}/${file}?v=${this.version}`)
				.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject()))
				.then((data) => context.decodeAudioData(data))
				.catch(() => null);
			this.buffers.set(file, promise);
		}
		return promise;
	}

	private spatial(context: AudioContext, x: number, y: number, z: number): PannerNode {
		const panner = context.createPanner();
		panner.panningModel = 'HRTF';
		panner.distanceModel = 'linear';
		panner.rolloffFactor = 0;
		panner.refDistance = 1;
		panner.maxDistance = 1e6;
		if (panner.positionX) {
			panner.positionX.value = x;
			panner.positionY.value = y;
			panner.positionZ.value = z;
		} else {
			panner.setPosition(x, y, z);
		}
		return panner;
	}

	private play(cue: Cue, speed: number) {
		const sound = this.sounds[cue.key];
		const context = this.context;
		if (!sound || !context || !this.master) return;
		const gain = sound.volume * curveGain(sound.curve, this.distance(cue.x, cue.y, cue.z));
		if (gain < 0.01) return;
		const file = sound.files[Math.floor(Math.random() * sound.files.length)]!;
		const scheduled = context.currentTime;
		void this.buffer(file).then((buffer) => {
			if (!buffer || context.currentTime - scheduled > 0.25) return;
			if (this.voices.length >= MAX_VOICES) {
				const weakest = this.voices.reduce((a, b) => (b.priority < a.priority ? b : a));
				if (weakest.priority > cue.priority) return;
				weakest.source.stop();
				this.voices.splice(this.voices.indexOf(weakest), 1);
			}
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.playbackRate.value =
				sound.pitch * Math.min(1.15, Math.max(0.85, speed)) * (0.97 + Math.random() * 0.06);
			const node = context.createGain();
			node.gain.value = Math.min(2, gain);
			source
				.connect(node)
				.connect(this.spatial(context, cue.x, cue.y, cue.z))
				.connect(this.master!);
			const voice = { source, priority: cue.priority };
			this.voices.push(voice);
			source.onended = () => {
				const index = this.voices.indexOf(voice);
				if (index >= 0) this.voices.splice(index, 1);
			};
			source.start();
		});
	}

	private stopMusic() {
		try {
			this.music?.stop();
		} catch {
			this.music?.disconnect();
		}
		this.music = null;
	}

	private announce(cue: Cue, replay: RoundReplay) {
		let key = cue.key;
		if (key === 'music:end') {
			const side = this.listener?.side;
			key =
				!replay.meta.winner || !side || side === replay.meta.winner ? 'music:won' : 'music:lost';
		}
		const sound = this.sounds[key];
		const context = this.context;
		if (!sound || !context || !this.master) return;
		const file = sound.files[Math.floor(Math.random() * sound.files.length)]!;
		const scheduled = context.currentTime;
		const music = cue.global === 'music';
		if (music) this.stopMusic();
		void this.buffer(file).then((buffer) => {
			if (!buffer || context.currentTime - scheduled > 0.4) return;
			const source = context.createBufferSource();
			source.buffer = buffer;
			const node = context.createGain();
			node.gain.value =
				sound.volume * (music ? MUSIC_VOLUME : cue.global === 'radio' ? RADIO_VOLUME : 0.6);
			source.connect(node).connect(this.master!);
			if (music) {
				this.stopMusic();
				this.music = source;
			}
			source.start();
		});
	}

	private updateLoops(replay: RoundReplay, tick: number, active: boolean) {
		const context = this.context!;
		const wanted = new Set<string>();
		const sound = this.sounds.fire;
		if (active && sound) {
			for (const effect of replay.meta.effects) {
				if (effect.type !== 'molotov' || tick < effect.startTick || tick > effect.endTick) continue;
				const key = `${replay.meta.round}:${effect.startTick}:${effect.x}`;
				wanted.add(key);
				let loop = this.loops.get(key);
				if (!loop) {
					const file = sound.files[0]!;
					const buffer = this.buffers.get(file);
					if (!buffer) {
						void this.buffer(file);
						continue;
					}
					const gain = context.createGain();
					gain.gain.value = 0;
					const panner = this.spatial(context, effect.x, effect.y, effect.z + 10);
					gain.connect(panner).connect(this.master!);
					const source = context.createBufferSource();
					source.loop = true;
					loop = { source, gain, panner, sound, x: effect.x, y: effect.y, z: effect.z };
					this.loops.set(key, loop);
					const started = loop;
					void buffer.then((data) => {
						if (!data || this.loops.get(key) !== started) return;
						source.buffer = data;
						source.connect(gain);
						source.start(0, Math.random() * data.duration);
					});
				}
				const fade = Math.min(1, (effect.endTick - tick) / replay.meta.tickRate);
				const target =
					sound.volume * fade * curveGain(sound.curve, this.distance(loop.x, loop.y, loop.z));
				loop.gain.gain.setTargetAtTime(target, context.currentTime, 0.1);
			}
		}
		for (const [key, loop] of this.loops) {
			if (wanted.has(key)) continue;
			loop.gain.gain.setTargetAtTime(0, context.currentTime, 0.05);
			try {
				loop.source.stop(context.currentTime + 0.3);
			} catch {
				loop.source.disconnect();
			}
			this.loops.delete(key);
		}
	}

	dispose() {
		this.stopMusic();
		for (const loop of this.loops.values()) loop.source.disconnect();
		this.loops.clear();
		void this.context?.close();
		this.context = null;
	}
}
