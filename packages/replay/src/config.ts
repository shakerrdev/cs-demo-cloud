export const SOUND_GROUPS = [
	'guns',
	'distant',
	'footsteps',
	'grenades',
	'fire',
	'bomb',
	'kills',
	'hits',
	'weapon',
	'music',
	'announcer'
] as const;

export type SoundGroup = (typeof SOUND_GROUPS)[number];

export type ViewMode = '2d' | '3d';
export type CameraModeSetting = 'free' | 'follow' | 'pov';
export type TextureQualitySetting = 'auto' | 'high' | 'medium' | 'low';

export interface SoundGroupConfig {
	enabled: boolean;
	volume: number;
}

export interface AppConfig {
	audio: {
		enabled: boolean;
		master: number;
		quietSpeed: number;
		groups: Record<SoundGroup, SoundGroupConfig>;
	};
	viewer: {
		view: ViewMode;
		camera: CameraModeSetting;
		speed: number;
		autoAdvance: boolean;
		leadIn: number;
		roundSeconds: number;
		bombSeconds: number;
		textures: TextureQualitySetting;
		hud: boolean;
		xray: boolean;
		nameplates: boolean;
	};
	pov: {
		fov: number;
		viewmodel: boolean;
		viewmodelFov: number;
		offsetX: number;
		offsetY: number;
		offsetZ: number;
		bob: boolean;
		sway: boolean;
		recoil: number;
		scope: boolean;
		flash: boolean;
		hitFlash: boolean;
		crosshair: boolean;
		crosshairColor: string;
		crosshairSize: number;
		crosshairGap: number;
		crosshairThickness: number;
		crosshairDot: boolean;
	};
	parsing: {
		viewRate: number;
	};
}

export const SOUND_GROUP_NAMES: Record<SoundGroup, string> = {
	guns: 'Gunshots',
	distant: 'Distant gunshots',
	footsteps: 'Footsteps and landings',
	grenades: 'Grenades (detonations and bounces)',
	fire: 'Molotov fire',
	bomb: 'Bomb (plant, beeps, defuse, explosion)',
	kills: 'Kills and deaths',
	hits: 'Hits',
	weapon: 'POV weapon (draw and zoom)',
	music: 'Music kit',
	announcer: 'Announcer'
};

const GROUP_VOLUMES: Partial<Record<SoundGroup, number>> = { music: 0.45, announcer: 0.9 };

export const defaultConfig: AppConfig = {
	audio: {
		enabled: true,
		master: 0.7,
		quietSpeed: 4,
		groups: Object.fromEntries(
			SOUND_GROUPS.map((group) => [group, { enabled: true, volume: GROUP_VOLUMES[group] ?? 1 }])
		) as Record<SoundGroup, SoundGroupConfig>
	},
	viewer: {
		view: '2d',
		camera: 'free',
		speed: 1,
		autoAdvance: true,
		leadIn: 3,
		roundSeconds: 115,
		bombSeconds: 40,
		textures: 'auto',
		hud: true,
		xray: true,
		nameplates: true
	},
	pov: {
		fov: 90,
		viewmodel: true,
		viewmodelFov: 68,
		offsetX: 2.5,
		offsetY: 0,
		offsetZ: -1.5,
		bob: true,
		sway: true,
		recoil: 0.9,
		scope: true,
		flash: true,
		hitFlash: true,
		crosshair: true,
		crosshairColor: '#78ff8c',
		crosshairSize: 7,
		crosshairGap: 7,
		crosshairThickness: 2,
		crosshairDot: false
	},
	parsing: {
		viewRate: 32
	}
};

interface FieldBase {
	path: string;
	label: string;
	help?: string;
}

export type ConfigField = FieldBase &
	(
		| { kind: 'toggle' }
		| { kind: 'range'; min: number; max: number; step: number; percent?: boolean; unit?: string }
		| { kind: 'select'; options: { value: string; label: string }[] }
		| { kind: 'color' }
	);

export interface ConfigSection {
	id: string;
	title: string;
	help?: string;
	fields: ConfigField[];
}

const percent = { kind: 'range', min: 0, max: 1.5, step: 0.05, percent: true } as const;

export const configSections: ConfigSection[] = [
	{
		id: 'audio',
		title: 'Sound',
		help: 'Volumes are relative to the game’s own mix. Everyone can still turn sound off in the viewer (M).',
		fields: [
			{ path: 'audio.enabled', label: 'Play sounds', kind: 'toggle' },
			{ path: 'audio.master', label: 'Master volume', ...percent, max: 1 },
			{
				path: 'audio.quietSpeed',
				label: 'Leave out footsteps and bounces from',
				kind: 'select',
				options: [
					{ value: '2', label: '2× and faster' },
					{ value: '4', label: '4× and faster' },
					{ value: '8', label: '8× (never)' }
				]
			},
			...SOUND_GROUPS.flatMap((group): ConfigField[] => [
				{ path: `audio.groups.${group}.enabled`, label: SOUND_GROUP_NAMES[group], kind: 'toggle' },
				{
					path: `audio.groups.${group}.volume`,
					label: `${SOUND_GROUP_NAMES[group]} volume`,
					...percent
				}
			])
		]
	},
	{
		id: 'viewer',
		title: 'Viewer',
		help: 'Defaults for everyone. What someone picks in the viewer (view, textures, HUD, X-ray) is remembered on their device and wins.',
		fields: [
			{
				path: 'viewer.view',
				label: 'Default view',
				kind: 'select',
				options: [
					{ value: '2d', label: '2D radar' },
					{ value: '3d', label: '3D' }
				]
			},
			{
				path: 'viewer.camera',
				label: 'Default 3D camera',
				kind: 'select',
				options: [
					{ value: 'free', label: 'Free' },
					{ value: 'follow', label: 'Follow' },
					{ value: 'pov', label: 'POV' }
				]
			},
			{
				path: 'viewer.speed',
				label: 'Default speed',
				kind: 'select',
				options: ['0.5', '1', '2', '4', '8'].map((value) => ({ value, label: `${value}×` }))
			},
			{
				path: 'viewer.textures',
				label: 'Default texture quality',
				kind: 'select',
				options: [
					{ value: 'auto', label: 'Auto' },
					{ value: 'high', label: 'High' },
					{ value: 'medium', label: 'Medium' },
					{ value: 'low', label: 'Low' }
				]
			},
			{ path: 'viewer.autoAdvance', label: 'Play the next round when one ends', kind: 'toggle' },
			{
				path: 'viewer.leadIn',
				label: 'Start rounds before freeze time ends',
				kind: 'range',
				min: 0,
				max: 20,
				step: 1,
				unit: 's'
			},
			{
				path: 'viewer.roundSeconds',
				label: 'Round time',
				help: 'For the round clock. Matchmaking and FACEIT use 1:55.',
				kind: 'range',
				min: 60,
				max: 300,
				step: 5,
				unit: 's'
			},
			{
				path: 'viewer.bombSeconds',
				label: 'Bomb timer',
				kind: 'range',
				min: 20,
				max: 60,
				step: 1,
				unit: 's'
			},
			{ path: 'viewer.hud', label: 'Game HUD in 3D', kind: 'toggle' },
			{ path: 'viewer.xray', label: 'Show players through walls (X-ray)', kind: 'toggle' },
			{ path: 'viewer.nameplates', label: 'Names over players in Free and Follow', kind: 'toggle' }
		]
	},
	{
		id: 'pov',
		title: 'First person (POV)',
		help: 'Matches the game’s settings: fov, viewmodel_fov, viewmodel_offset_x/y/z, cl_crosshair*.',
		fields: [
			{
				path: 'pov.fov',
				label: 'Field of view (4:3, like the game)',
				kind: 'range',
				min: 70,
				max: 110,
				step: 1,
				unit: '°'
			},
			{ path: 'pov.viewmodel', label: 'Show arms and weapon', kind: 'toggle' },
			{
				path: 'pov.viewmodelFov',
				label: 'Viewmodel FOV',
				kind: 'range',
				min: 54,
				max: 68,
				step: 1,
				unit: '°'
			},
			{
				path: 'pov.offsetX',
				label: 'Viewmodel offset X',
				kind: 'range',
				min: -2.5,
				max: 2.5,
				step: 0.5
			},
			{
				path: 'pov.offsetY',
				label: 'Viewmodel offset Y',
				kind: 'range',
				min: -2,
				max: 2,
				step: 0.5
			},
			{
				path: 'pov.offsetZ',
				label: 'Viewmodel offset Z',
				kind: 'range',
				min: -2,
				max: 2,
				step: 0.5
			},
			{ path: 'pov.bob', label: 'Viewmodel bob while moving', kind: 'toggle' },
			{ path: 'pov.sway', label: 'Viewmodel sway while turning', kind: 'toggle' },
			{
				path: 'pov.recoil',
				label: 'Camera kick while spraying',
				help: 'Share of the aim punch the camera follows. The game uses 90%.',
				kind: 'range',
				min: 0,
				max: 1.5,
				step: 0.05,
				percent: true
			},
			{ path: 'pov.scope', label: 'Scope overlay and zoom', kind: 'toggle' },
			{ path: 'pov.flash', label: 'White screen when flashed', kind: 'toggle' },
			{ path: 'pov.hitFlash', label: 'Red flash when hit', kind: 'toggle' },
			{ path: 'pov.crosshair', label: 'Crosshair', kind: 'toggle' },
			{ path: 'pov.crosshairColor', label: 'Crosshair colour', kind: 'color' },
			{
				path: 'pov.crosshairSize',
				label: 'Crosshair size',
				kind: 'range',
				min: 1,
				max: 20,
				step: 1
			},
			{ path: 'pov.crosshairGap', label: 'Crosshair gap', kind: 'range', min: 0, max: 20, step: 1 },
			{
				path: 'pov.crosshairThickness',
				label: 'Crosshair thickness',
				kind: 'range',
				min: 1,
				max: 6,
				step: 0.5
			},
			{ path: 'pov.crosshairDot', label: 'Crosshair dot', kind: 'toggle' }
		]
	},
	{
		id: 'parsing',
		title: 'Parsing',
		fields: [
			{
				path: 'parsing.viewRate',
				label: 'First-person view samples',
				help: 'Smoother POV and recoil. 32 per second makes replays about three times bigger, 64 (every tick on 64-tick demos) about five times, and parsing slower. Applies to demos parsed from now on.',
				kind: 'select',
				options: [
					{ value: '0', label: 'Off' },
					{ value: '32', label: '32 per second' },
					{ value: '64', label: '64 per second' }
				]
			}
		]
	}
];

export const configFields: ConfigField[] = configSections.flatMap((section) => section.fields);

export function readPath(source: unknown, path: string): unknown {
	let value = source;
	for (const part of path.split('.')) {
		if (!value || typeof value !== 'object') return undefined;
		value = (value as Record<string, unknown>)[part];
	}
	return value;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown) {
	const parts = path.split('.');
	let node = target;
	for (const part of parts.slice(0, -1)) {
		if (!node[part] || typeof node[part] !== 'object') node[part] = {};
		node = node[part] as Record<string, unknown>;
	}
	node[parts.at(-1)!] = value;
}

function cleanValue(field: ConfigField, value: unknown, fallback: unknown): unknown {
	switch (field.kind) {
		case 'toggle':
			return typeof value === 'boolean' ? value : fallback;
		case 'range': {
			const number = typeof value === 'string' ? Number(value) : value;
			if (typeof number !== 'number' || !Number.isFinite(number)) return fallback;
			return Math.min(field.max, Math.max(field.min, number));
		}
		case 'select': {
			const text = typeof value === 'number' ? String(value) : value;
			if (typeof text !== 'string' || !field.options.some((option) => option.value === text))
				return fallback;
			return typeof fallback === 'number' ? Number(text) : text;
		}
		case 'color':
			return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
				? value.toLowerCase()
				: fallback;
	}
}

function upgradeRaw(raw: unknown): unknown {
	const parsing = readPath(raw, 'parsing') as Record<string, unknown> | undefined;
	if (parsing && parsing.viewRate === undefined && typeof parsing.viewStream === 'boolean') {
		return { ...(raw as object), parsing: { ...parsing, viewRate: parsing.viewStream ? 32 : 0 } };
	}
	return raw;
}

export function normalizeConfig(raw: unknown): AppConfig {
	raw = upgradeRaw(raw);
	const config = structuredClone(defaultConfig) as unknown as Record<string, unknown>;
	for (const field of configFields) {
		const fallback = readPath(defaultConfig, field.path);
		writePath(config, field.path, cleanValue(field, readPath(raw, field.path), fallback));
	}
	return config as unknown as AppConfig;
}

export function configFromForm(form: {
	get(name: string): unknown;
	has(name: string): boolean;
}): AppConfig {
	const raw: Record<string, unknown> = {};
	for (const field of configFields) {
		const value = field.kind === 'toggle' ? form.has(field.path) : form.get(field.path);
		writePath(raw, field.path, value);
	}
	return normalizeConfig(raw);
}

export function soundGroupOf(key: string): SoundGroup {
	const kind = key.split(':')[0]!;
	switch (kind) {
		case 'shot':
			return 'guns';
		case 'far':
			return 'distant';
		case 'step':
		case 'land':
			return 'footsteps';
		case 'fire':
			return 'fire';
		case 'bomb':
			return 'bomb';
		case 'kill':
		case 'death':
			return 'kills';
		case 'hit':
			return 'hits';
		case 'draw':
		case 'zoom':
			return 'weapon';
		case 'music':
			return 'music';
		case 'radio':
			return 'announcer';
		default:
			return 'grenades';
	}
}

export function horizontalToVerticalFov(horizontal43: number): number {
	const rad = Math.PI / 180;
	return (2 * Math.atan(Math.tan((horizontal43 * rad) / 2) * 0.75)) / rad;
}
