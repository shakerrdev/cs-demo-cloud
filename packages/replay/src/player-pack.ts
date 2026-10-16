import type { PackTextureRef } from './map-pack.ts';
import type { Side } from './types.ts';

export const PLAYER_PACK_VERSION = 1;
export const PLAYER_PACK_MANIFEST = 'players.json';
export const PLAYER_PACK_NAME = 'players';

export type WeaponClass = 'rifle' | 'pistol' | 'knife' | 'grenade' | 'c4';

export interface PlayerPackManifest {
	version: number;
	exportedAt: string;
	build: string | null;
	tools: Record<string, string>;
	characters: Record<Side, string>;
	animations: string;
	clips: string[];
	weapons: Record<string, PlayerPackWeapon>;
	sounds?: Record<string, PlayerPackSound>;
	viewmodel?: PlayerPackViewmodel;
	textures: Record<string, PackTextureRef>;
}

export interface PlayerPackViewmodel {
	animations: string[];
	clips: string[];
}

export interface ViewmodelClips {
	draw: string;
	idle: string;
	shoot?: string;
	reload?: string;
	attack?: string[];
	pullpin?: string;
	throw?: string;
	plant?: string;
}

export interface PlayerPackSound {
	files: string[];
	volume: number;
	pitch: number;
	curve: number[];
	loop?: boolean;
}

export interface PlayerPackWeapon {
	model: string;
	translation: number[];
	rotation: number[];
}

const ALIASES: Record<string, string> = {
	ak47: 'ak47',
	aug: 'aug',
	awp: 'awp',
	bizon: 'bizon',
	ppbizon: 'bizon',
	cz75a: 'cz75a',
	cz75auto: 'cz75a',
	deagle: 'deagle',
	deserteagle: 'deagle',
	elite: 'elite',
	dualberettas: 'elite',
	famas: 'famas',
	fiveseven: 'fiveseven',
	g3sg1: 'g3sg1',
	galilar: 'galilar',
	glock: 'glock',
	glock18: 'glock',
	hkp2000: 'hkp2000',
	p2000: 'hkp2000',
	m249: 'm249',
	m4a1: 'm4a4',
	m4a4: 'm4a4',
	m4a1s: 'm4a1_silencer',
	m4a1silencer: 'm4a1_silencer',
	mac10: 'mac10',
	mag7: 'mag7',
	mp5sd: 'mp5sd',
	mp7: 'mp7',
	mp9: 'mp9',
	negev: 'negev',
	nova: 'nova',
	p250: 'p250',
	p90: 'p90',
	revolver: 'revolver',
	r8revolver: 'revolver',
	sawedoff: 'sawedoff',
	scar20: 'scar20',
	sg553: 'sg556',
	sg556: 'sg556',
	ssg08: 'ssg08',
	taser: 'taser',
	zeusx27: 'taser',
	tec9: 'tec9',
	ump45: 'ump45',
	usps: 'usp_silencer',
	uspsilencer: 'usp_silencer',
	xm1014: 'xm1014',
	hegrenade: 'hegrenade',
	highexplosivegrenade: 'hegrenade',
	flashbang: 'flashbang',
	smokegrenade: 'smokegrenade',
	molotov: 'molotov',
	incgrenade: 'incgrenade',
	incendiarygrenade: 'incgrenade',
	decoy: 'decoy',
	decoygrenade: 'decoy',
	c4: 'c4',
	c4explosive: 'c4',
	weaponc4: 'c4'
};

const KNIVES: [RegExp, string][] = [
	[/karambit/, 'knife_karambit'],
	[/butterfly/, 'knife_butterfly'],
	[/m9/, 'knife_m9'],
	[/bayonet/, 'knife_bayonet'],
	[/flip/, 'knife_flip'],
	[/gut/, 'knife_gut'],
	[/huntsman|tactical/, 'knife_tactical'],
	[/falchion/, 'knife_falchion'],
	[/bowie/, 'knife_bowie'],
	[/shadowdagger|push/, 'knife_push'],
	[/navaja/, 'knife_navaja'],
	[/stiletto/, 'knife_stiletto'],
	[/talon/, 'knife_talon'],
	[/ursus/, 'knife_ursus'],
	[/paracord|cord/, 'knife_cord'],
	[/survival|canis/, 'knife_canis'],
	[/nomad|outdoor/, 'knife_outdoor'],
	[/skeleton/, 'knife_skeleton'],
	[/classic|css/, 'knife_css'],
	[/kukri/, 'knife_kukri']
];

const ITEMS: Record<number, string> = {
	1: 'deagle',
	2: 'elite',
	3: 'fiveseven',
	4: 'glock',
	7: 'ak47',
	8: 'aug',
	9: 'awp',
	10: 'famas',
	11: 'g3sg1',
	13: 'galilar',
	14: 'm249',
	16: 'm4a4',
	17: 'mac10',
	19: 'p90',
	23: 'mp5sd',
	24: 'ump45',
	25: 'xm1014',
	26: 'bizon',
	27: 'mag7',
	28: 'negev',
	29: 'sawedoff',
	30: 'tec9',
	31: 'taser',
	32: 'hkp2000',
	33: 'mp7',
	34: 'mp9',
	35: 'nova',
	36: 'p250',
	38: 'scar20',
	39: 'sg556',
	40: 'ssg08',
	42: 'knife',
	59: 'knife',
	60: 'm4a1_silencer',
	61: 'usp_silencer',
	63: 'cz75a',
	64: 'revolver',
	500: 'knife_bayonet',
	503: 'knife_css',
	505: 'knife_flip',
	506: 'knife_gut',
	507: 'knife_karambit',
	508: 'knife_m9',
	509: 'knife_tactical',
	512: 'knife_falchion',
	514: 'knife_bowie',
	515: 'knife_butterfly',
	516: 'knife_push',
	517: 'knife_cord',
	518: 'knife_canis',
	519: 'knife_ursus',
	520: 'knife_navaja',
	521: 'knife_outdoor',
	522: 'knife_stiletto',
	523: 'knife_talon',
	525: 'knife_skeleton',
	526: 'knife_kukri'
};

export function itemWeaponKey(item: number): string | null {
	return ITEMS[item] ?? null;
}

export function weaponKey(name: string): string | null {
	const flat = name
		.toLowerCase()
		.replace(/^weapon_/, '')
		.replace(/[^a-z0-9]/g, '');
	if (!flat) return null;
	const alias = ALIASES[flat];
	if (alias) return alias;
	if (/knife|bayonet|karambit|dagger/.test(flat) || KNIVES.some(([test]) => test.test(flat))) {
		for (const [test, key] of KNIVES) if (test.test(flat)) return key;
		return 'knife';
	}
	return null;
}

const PISTOLS = new Set([
	'cz75a',
	'deagle',
	'elite',
	'fiveseven',
	'glock',
	'hkp2000',
	'p250',
	'revolver',
	'taser',
	'tec9',
	'usp_silencer'
]);
const GRENADES = new Set([
	'hegrenade',
	'flashbang',
	'smokegrenade',
	'molotov',
	'incgrenade',
	'decoy'
]);

export function weaponClass(key: string | null): WeaponClass {
	if (!key) return 'knife';
	if (key === 'c4') return 'c4';
	if (key.startsWith('knife')) return 'knife';
	if (GRENADES.has(key)) return 'grenade';
	if (PISTOLS.has(key)) return 'pistol';
	return 'rifle';
}

export function weaponModelKey(key: string | null, side: Side): string | null {
	if (!key) return null;
	if (key === 'knife') return side === 'CT' ? 'knife_default_ct' : 'knife_default_t';
	return key;
}

const POSE_NAMES: Record<string, string> = {
	ak47: 'ak',
	aug: 'aug',
	awp: 'awp',
	bizon: 'bizon',
	famas: 'famas',
	g3sg1: 'g3sg1',
	galilar: 'galilar',
	m249: 'm249',
	m4a1_silencer: 'm4a1s',
	m4a4: 'm4a4',
	mac10: 'mac10',
	mag7: 'mag7',
	mp5sd: 'mp5sd',
	mp7: 'mp7',
	mp9: 'mp9',
	negev: 'negev',
	nova: 'nova',
	p90: 'p90',
	sawedoff: 'sawedoff',
	scar20: 'scar20',
	sg556: 'sg556',
	ssg08: 'ssg08',
	ump45: 'ump45',
	xm1014: 'xm1014',
	cz75a: 'cz75a',
	deagle: 'deagle',
	elite: 'elite',
	fiveseven: 'fiveseven',
	glock: 'glock',
	hkp2000: 'hkp',
	p250: 'p250',
	revolver: 'revolver',
	taser: 'taser',
	tec9: 'tec9',
	usp_silencer: 'usp'
};

const SHOOT_NAMES: Record<string, string> = { cz75a: 'shoot_cz75', elite: 'shoot_right1_elite' };

export function weaponPoseName(key: string | null): string | null {
	if (!key) return null;
	if (key === 'c4') return 'c4';
	if (key === 'molotov' || key === 'incgrenade') return 'molotov';
	if (GRENADES.has(key)) return 'grenade';
	return POSE_NAMES[key] ?? null;
}

export function weaponShootName(key: string | null): string | null {
	if (!key || !POSE_NAMES[key]) return null;
	return SHOOT_NAMES[key] ?? `shoot_${POSE_NAMES[key]}`;
}

const VIEWMODEL_NAMES: Record<string, string> = {
	...POSE_NAMES,
	m4a1_silencer: 'rifle',
	usp_silencer: 'pistol'
};
const VIEWMODEL_IDLE: Record<string, string> = { g3sg1: 'idle1', m249: 'idle1' };
const VIEWMODEL_GRENADES: Record<string, string> = {
	flashbang: 'flashbang',
	hegrenade: 'hegrenade',
	incgrenade: 'incendiary',
	molotov: 'molotov',
	smokegrenade: 'smoke',
	decoy: 'grenade'
};

export function viewmodelClips(key: string | null): ViewmodelClips | null {
	if (!key) return null;
	if (key === 'c4') return { draw: 'draw_c4', idle: 'idle_c4', plant: 'plant_c4' };
	const grenade = VIEWMODEL_GRENADES[key];
	if (grenade)
		return {
			draw: `draw_${grenade}`,
			idle: `idle_${grenade}`,
			pullpin: `pullpin_${grenade}`,
			throw: `throw_overhand_${grenade}`
		};
	if (key.startsWith('knife')) {
		const name =
			key === 'knife' || key === 'knife_default_ct' ? 'knife' : key.replace(/^knife_/, '');
		const plain = name === 'knife' || name === 'default_t';
		return {
			draw: `draw_${name}`,
			idle: `${plain ? 'idle' : 'idle1'}_${name}`,
			attack: [`light_miss1_${name}`, `heavy_miss1_${name}`]
		};
	}
	const name = VIEWMODEL_NAMES[key];
	if (!name) return null;
	return {
		draw: `draw_${name}`,
		idle: `${VIEWMODEL_IDLE[key] ?? 'idle'}_${name}`,
		shoot: key === 'elite' ? 'shoot_right1_elite' : `shoot1_${name}`,
		reload: key === 'taser' ? undefined : `reload_${name}`
	};
}

export function viewmodelClipNames(keys: string[]): string[] {
	const clips = new Set<string>();
	for (const key of keys) {
		const set = viewmodelClips(key);
		if (!set) continue;
		for (const value of Object.values(set))
			for (const clip of Array.isArray(value) ? value : [value]) if (clip) clips.add(clip);
	}
	return [...clips];
}

export const LOCOMOTION_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export const LOCOMOTION_CLASSES = ['rifle', 'pistol', 'knife'] as const;

export function playerClipNames(): string[] {
	const clips: string[] = [];
	for (const c of LOCOMOTION_CLASSES) {
		clips.push(`idle_${c}`, `idle_crouch_${c}`, `inair_stand_${c}`);
		for (const gait of ['walk', 'run', 'crouch'])
			for (const d of LOCOMOTION_DIRECTIONS) clips.push(`${gait}_${d}_${c}`);
		clips.push(`defuse_loop_${c}`, `defuse_crouch_loop_${c}`);
	}
	clips.push('flashed', 'flashed_crouch', 'planting', 'planting_crouch', 'throw_overhand_grenade');
	for (const key of Object.keys(POSE_NAMES)) {
		const pose = POSE_NAMES[key]!;
		clips.push(`idle_${pose}`, `idle_crouch_${pose}`, weaponShootName(key)!);
	}
	clips.push('idle_grenade', 'idle_crouch_grenade', 'idle_molotov', 'idle_crouch_molotov');
	clips.push('idle_c4', 'idle_crouch_c4');
	return [...new Set(clips)];
}

export const SKINS_PACK_VERSION = 1;
export const SKINS_PACK_MANIFEST = 'skins.json';
export const SKINS_PACK_NAME = 'skins';

export interface SkinsPackManifest {
	version: number;
	exportedAt: string;
	build: string | null;
	tools: Record<string, string>;
	agents: Record<string, string>;
	weapons: Record<string, SkinWeapon>;
	paints: Record<string, SkinPaint>;
	textures: Record<string, PackTextureRef>;
}

export interface SkinWeapon {
	model?: string;
	translation?: number[];
	rotation?: number[];
	textures: Record<string, string>;
	uvScale: number;
	weaponLength: number;
}

export interface SkinPaint {
	name: string;
	style: number;
	legacy: boolean;
	wear: [number, number];
	ints: Record<string, number>;
	floats: Record<string, number>;
	vectors: Record<string, number[]>;
	textures: Record<string, string>;
}

export function skinWeaponKey(key: string, legacy: boolean): string {
	return legacy ? `${key}:legacy` : key;
}
