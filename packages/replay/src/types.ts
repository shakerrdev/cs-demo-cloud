export const REPLAY_VERSION = 3;
export const VIEW_POSITION_SCALE = 16;
export const PUNCH_SCALE = 100;

export type Side = 'CT' | 'T';
export type TeamKey = 'a' | 'b';
export type GrenadeType = 'smoke' | 'flash' | 'he' | 'molotov' | 'decoy';
export type BombEventType =
	'pickup' | 'drop' | 'plant_start' | 'plant' | 'defuse_start' | 'defuse' | 'explode';

export const FLAG_ALIVE = 1;
export const FLAG_HELMET = 2;
export const FLAG_DEFUSER = 4;
export const FLAG_DEFUSING = 8;
export const FLAG_SCOPED = 16;
export const FLAG_DUCKING = 32;
export const FLAG_PRESENT = 64;
export const FLAG_BOMB = 128;

export interface ReplayPlayer {
	steamid: string;
	name: string;
	team: TeamKey;
	side: Side;
	agent?: string;
	crosshair?: string;
	viewmodel?: [fov: number, x: number, y: number, z: number];
	musicKit?: number;
	gloves?: ReplaySkin;
}

export interface ReplaySkin {
	item: number;
	paint: number;
	seed: number;
	wear: number;
}

export interface ReplayKill {
	tick: number;
	attacker: number;
	victim: number;
	assister: number;
	weapon: string;
	headshot: boolean;
	wallbang: boolean;
	throughSmoke: boolean;
	noScope: boolean;
	attackerBlind: boolean;
	flashAssist: boolean;
	x: number;
	y: number;
	z: number;
}

export interface ReplayGrenade {
	type: GrenadeType;
	thrower: number;
	path: number[];
}

export interface ReplayEffect {
	type: GrenadeType;
	thrower: number;
	startTick: number;
	endTick: number;
	x: number;
	y: number;
	z: number;
}

export interface ReplayBombEvent {
	type: BombEventType;
	tick: number;
	player: number;
	x: number;
	y: number;
	z: number;
	site: string | null;
}

export interface ReplayBlind {
	tick: number;
	player: number;
	attacker: number;
	duration: number;
}

export interface RoundMeta {
	version: number;
	round: number;
	tickRate: number;
	tickStep: number;
	startTick: number;
	frameCount: number;
	freezeEndTick: number | null;
	endTick: number;
	winner: Side | null;
	reason: string | null;
	scoreA: number;
	scoreB: number;
	players: ReplayPlayer[];
	weapons: string[];
	kills: ReplayKill[];
	shots: number[];
	swings?: number[];
	reloads?: number[];
	skins?: ReplaySkin[];
	skinChanges?: number[];
	grenades: ReplayGrenade[];
	effects: ReplayEffect[];
	bomb: ReplayBombEvent[];
	blinds: ReplayBlind[];
	inventory?: number[];
	hurts?: number[];
	bullets?: number[];
	impacts?: number[];
	steps?: number[];
	places?: string[];
	view?: RoundViewGrid;
}

export interface RoundViewGrid {
	tickStep: number;
	startTick: number;
	frameCount: number;
}

export interface RoundColumns {
	x: Int16Array;
	y: Int16Array;
	z: Int16Array;
	yaw: Uint16Array;
	pitch: Int16Array;
	money: Uint16Array;
	health: Uint8Array;
	armor: Uint8Array;
	weapon: Uint8Array;
	flags: Uint8Array;
	clip?: Uint8Array;
	reserve?: Uint8Array;
	zoom?: Uint8Array;
	place?: Uint8Array;
}

export interface ViewColumns {
	x: Int32Array;
	y: Int32Array;
	z: Int32Array;
	yaw: Uint16Array;
	pitch: Int16Array;
	punchPitch: Int16Array;
	punchYaw: Int16Array;
	duck: Uint8Array;
}

export interface RoundReplay {
	meta: RoundMeta;
	columns: RoundColumns;
	view?: ViewColumns;
}

export const BULLET_STRIDE = 11;
export const IMPACT_STRIDE = 9;

export const IMPACT_WALL = 0;
export const IMPACT_FLESH = 1;
export const IMPACT_BLOOD = 2;
export const IMPACT_MISS = 3;
