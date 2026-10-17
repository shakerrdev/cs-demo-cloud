import * as demoparser from '@laihoe/demoparser2';

export type RawEvent = Record<string, unknown> & { event_name: string; tick: number };

export interface RawGrenade {
	grenade_entity_id: number;
	grenade_type: string;
	steamid: string | null;
	name: string | null;
	tick: number;
	x: number | null;
	y: number | null;
	z: number | null;
}

export const eventNames = [
	'round_start',
	'round_end',
	'round_freeze_end',
	'begin_new_match',
	'cs_win_panel_match',
	'player_death',
	'player_blind',
	'weapon_fire',
	'weapon_reload',
	'bomb_pickup',
	'bomb_dropped',
	'bomb_beginplant',
	'bomb_planted',
	'bomb_begindefuse',
	'bomb_defused',
	'bomb_exploded',
	'smokegrenade_detonate',
	'smokegrenade_expired',
	'inferno_startburn',
	'inferno_expire',
	'flashbang_detonate',
	'hegrenade_detonate',
	'decoy_started'
];

export const tickProps = [
	'X',
	'Y',
	'Z',
	'yaw',
	'pitch',
	'health',
	'armor_value',
	'active_weapon_name',
	'is_alive',
	'team_num',
	'balance',
	'has_defuser',
	'has_helmet',
	'is_defusing',
	'is_scoped',
	'duck_amount',
	'which_bomb_zone',
	'kills_total',
	'deaths_total',
	'assists_total',
	'damage_total',
	'headshot_kills_total',
	'mvps',
	'score',
	'team_clan_name',
	'game_time',
	'agent_skin',
	'weapon_skin_id',
	'weapon_paint_seed',
	'weapon_float',
	'm_iItemDefinitionIndex',
	'm_iItemIDLow',
	'm_iItemIDHigh',
	'active_weapon_ammo',
	'total_ammo_left',
	'zoom_lvl',
	'inventory',
	'last_place_name'
] as const;

export const viewProps = ['X', 'Y', 'Z', 'yaw', 'pitch', 'aim_punch_angle', 'duck_amount'] as const;

export type ViewProp = (typeof viewProps)[number];

export type ViewRows = { [K in ViewProp]: unknown[] } & {
	tick: number[];
	steamid: string[];
	name: string[];
};

export type TickProp = (typeof tickProps)[number];

export type TickColumns = { [K in TickProp]: unknown[] } & {
	tick: number[];
	steamid: string[];
	name: string[];
};

export interface DemoHeader {
	map_name: string;
	server_name: string;
}

export function parseHeader(path: string): DemoHeader {
	return demoparser.parseHeader(path) as DemoHeader;
}

export function parseEvents(path: string): RawEvent[] {
	return demoparser.parseEvents(
		path,
		eventNames,
		['X', 'Y', 'Z'],
		['is_warmup_period']
	) as RawEvent[];
}

export function parseTicks(path: string, ticks: number[]): TickColumns {
	return demoparser.parseTicks(path, [...tickProps], ticks, null, true) as TickColumns;
}

export function parseView(path: string, ticks: number[]): ViewRows {
	return demoparser.parseTicks(path, [...viewProps], ticks, null, true) as ViewRows;
}

export function parseGrenades(path: string): RawGrenade[] {
	return demoparser.parseGrenades(path, null, false) as RawGrenade[];
}

export const num = (value: unknown, fallback = 0): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const str = (value: unknown): string | null =>
	typeof value === 'string' && value.length > 0 ? value : null;

export const bool = (value: unknown): boolean => value === true;
