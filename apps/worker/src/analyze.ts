import type { NewKill, NewMatchPlayer, NewRound, Platform } from '@cs-demo-cloud/db';
import {
	FLAG_ALIVE,
	FLAG_BOMB,
	FLAG_DEFUSER,
	FLAG_DEFUSING,
	FLAG_DUCKING,
	FLAG_HELMET,
	FLAG_PRESENT,
	FLAG_SCOPED,
	PUNCH_SCALE,
	REPLAY_VERSION,
	VIEW_POSITION_SCALE,
	createColumns,
	createViewColumns,
	packPitch,
	packYaw,
	type BombEventType,
	type GrenadeType,
	type ReplayBombEvent,
	type ReplayEffect,
	type ReplayGrenade,
	type ReplayKill,
	type ReplaySkin,
	type RoundColumns,
	type RoundReplay,
	type Side,
	type TeamKey,
	type ViewColumns,
	itemWeaponKey,
	weaponKey
} from '@cs-demo-cloud/replay';
import {
	bool,
	num,
	parseEvents,
	parseGrenades,
	parseHeader,
	parseTicks,
	parseSettings,
	parseSkins,
	parseView,
	str,
	type RawEvent,
	type RawGrenade,
	type TickColumns,
	type ViewRows
} from './parser.ts';
import { detectRounds, type RoundSpan } from './rounds.ts';
import { glovesBySteamId, settingsAt, type PlayerSettings } from './settings.ts';
import { assignTeams } from './teams.ts';

const STEP = 4;
const CT = 3;
const T = 2;

export interface AnalyzedDemo {
	map: string;
	serverName: string;
	platform: Platform;
	tickRate: number;
	durationSeconds: number;
	scoreA: number;
	scoreB: number;
	teamAName: string | null;
	teamBName: string | null;
	teamAStartSide: Side;
	players: Omit<NewMatchPlayer, 'demoId'>[];
	rounds: Omit<NewRound, 'demoId'>[];
	kills: Omit<NewKill, 'demoId'>[];
	replays: RoundReplay[];
}

interface Grid {
	first: number;
	count: number;
}

interface PlayerEntry {
	key: string;
	steamid: string;
	name: string;
	lastRow: number;
	lastTick: number;
	sideRows: Map<number, [ct: number, t: number]>;
}

const clamp16 = (value: number) => Math.max(-32768, Math.min(32767, Math.round(value)));
const clampU8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const clamp32 = (value: number) => Math.max(-2147483648, Math.min(2147483647, Math.round(value)));

function indexIn(table: Map<string, number>, name: string): number {
	let index = table.get(name);
	if (index === undefined) {
		index = table.size;
		if (index < 256) table.set(name, index);
		else index = 0;
	}
	return index;
}

function gridFor(span: RoundSpan, step: number): Grid {
	const first = Math.ceil(span.startTick / step) * step;
	const last = Math.max(first, Math.floor(span.lastTick / step) * step);
	return { first, count: (last - first) / step + 1 };
}

export function playerKey(steamid: unknown, name: unknown): string {
	const id = str(steamid);
	return id && id !== '0' ? id : `bot:${str(name) ?? 'unknown'}`;
}

function detectPlatform(serverName: string): Platform {
	if (/valve/i.test(serverName)) return 'valve';
	if (/faceit/i.test(serverName)) return 'faceit';
	return 'other';
}

function measureTickRate(ticks: TickColumns): number {
	const count = ticks.tick.length;
	if (count < 2) return 64;
	const first = 0;
	const last = count - 1;
	const elapsed = num(ticks.game_time[last]) - num(ticks.game_time[first]);
	const rate = (ticks.tick[last]! - ticks.tick[first]!) / elapsed;
	return Number.isFinite(rate) && rate > 0 ? Math.round(rate) : 64;
}

export function analyzeDemo(
	path: string,
	timings: (step: string) => void = () => {},
	options: { viewRate?: number } = {}
): AnalyzedDemo {
	const header = parseHeader(path);
	const events = parseEvents(path);
	timings('events');

	const demoLastTick = events.reduce((max, e) => Math.max(max, e.tick), 0);
	const spans = detectRounds(events, demoLastTick, 64);
	if (spans.length === 0) throw new Error('No completed rounds found in this demo');

	const grids: Grid[] = spans.map((span) => gridFor(span, STEP));
	const wanted = new Set<number>();
	for (const grid of grids) for (let f = 0; f < grid.count; f++) wanted.add(grid.first + f * STEP);

	const ticks = parseTicks(
		path,
		[...wanted].sort((a, b) => a - b)
	);
	timings('ticks');
	const tickRate = measureTickRate(ticks);

	const roundsAtTick = (tick: number): number[] => {
		const found: number[] = [];
		for (let r = 0; r < grids.length; r++) {
			const grid = grids[r]!;
			if (tick >= grid.first && tick <= grid.first + (grid.count - 1) * STEP) found.push(r);
			else if (grid.first > tick) break;
		}
		return found;
	};
	const roundIndexForTick = (tick: number): number =>
		spans.findIndex((span) => tick >= span.startTick && tick <= span.lastTick);

	const players = new Map<string, PlayerEntry>();
	const rowRounds: number[][] = new Array(ticks.tick.length);
	for (let i = 0; i < ticks.tick.length; i++) {
		const team = num(ticks.team_num[i]);
		if (team !== CT && team !== T) continue;
		const tick = ticks.tick[i]!;
		const key = playerKey(ticks.steamid[i], ticks.name[i]);
		let entry = players.get(key);
		if (!entry) {
			entry = {
				key,
				steamid: key,
				name: ticks.name[i] ?? key,
				lastRow: i,
				lastTick: -1,
				sideRows: new Map()
			};
			players.set(key, entry);
		}
		if (tick >= entry.lastTick) {
			entry.lastRow = i;
			entry.lastTick = tick;
			entry.name = ticks.name[i] ?? entry.name;
		}
		const rounds = roundsAtTick(tick);
		rowRounds[i] = rounds;
		for (const r of rounds) {
			const counts = entry.sideRows.get(r) ?? [0, 0];
			counts[team === CT ? 0 : 1]++;
			entry.sideRows.set(r, counts);
		}
	}
	if (players.size === 0) throw new Error('No players found in this demo');

	const { teamASides, teams } = assignTeams([...players.values()], spans.length);
	const teamOf = (entry: PlayerEntry): TeamKey => teams.get(entry.key) ?? 'b';

	const roundPlayers = spans.map((_, r) =>
		[...players.values()]
			.filter((entry) => entry.sideRows.has(r))
			.sort((a, b) => teamOf(a).localeCompare(teamOf(b)) || a.name.localeCompare(b.name))
	);
	const playerIndex = roundPlayers.map((list) => new Map(list.map((entry, i) => [entry.key, i])));
	const indexOf = (round: number, steamid: unknown, name: unknown): number =>
		playerIndex[round]?.get(playerKey(steamid, name)) ?? -1;

	const columns: RoundColumns[] = grids.map((grid, r) =>
		createColumns(roundPlayers[r]!.length * grid.count)
	);
	const weaponTables = spans.map(() => new Map<string, number>([['', 0]]));
	const skinTables = spans.map(() => new Map<string, number>());
	const skinLists = spans.map(() => [] as ReplaySkin[]);
	const skinChanges = spans.map(() => [] as number[]);
	const lastSkins = spans.map(() => new Map<number, number>());
	const agents = spans.map(() => new Map<number, string>());
	const inventories = spans.map(() => [] as number[]);
	const placeTables = spans.map(() => new Map<string, number>([['', 0]]));
	const lastInventories = spans.map(() => new Map<number, string>());

	for (let i = 0; i < ticks.tick.length; i++) {
		const rounds = rowRounds[i];
		if (!rounds) continue;
		const key = playerKey(ticks.steamid[i], ticks.name[i]);
		for (const r of rounds) {
			const p = playerIndex[r]!.get(key);
			if (p === undefined) continue;
			const grid = grids[r]!;
			const cols = columns[r]!;
			const at = p * grid.count + (ticks.tick[i]! - grid.first) / STEP;
			const weapons = weaponTables[r]!;
			const weaponName = str(ticks.active_weapon_name[i]) ?? '';
			const weapon = indexIn(weapons, weaponName);

			cols.x[at] = clamp16(num(ticks.X[i]));
			cols.y[at] = clamp16(num(ticks.Y[i]));
			cols.z[at] = clamp16(num(ticks.Z[i]));
			cols.yaw[at] = packYaw(num(ticks.yaw[i]));
			cols.pitch[at] = clamp16(packPitch(num(ticks.pitch[i])));
			cols.money[at] = Math.max(0, Math.min(65535, num(ticks.balance[i])));
			cols.health[at] = clampU8(num(ticks.health[i]));
			cols.armor[at] = clampU8(num(ticks.armor_value[i]));
			cols.weapon[at] = weapon;
			cols.clip![at] = clampU8(num(ticks.active_weapon_ammo[i]));
			cols.reserve![at] = clampU8(num(ticks.total_ammo_left[i]));
			cols.zoom![at] = clampU8(num(ticks.zoom_lvl[i]));
			cols.place![at] = indexIn(placeTables[r]!, str(ticks.last_place_name[i]) ?? '');
			const owned = ticks.inventory[i];
			if (Array.isArray(owned)) {
				const items = owned
					.map((name) => (typeof name === 'string' ? indexIn(weapons, name) : 0))
					.filter((index) => index > 0);
				const key = items.join(',');
				if (lastInventories[r]!.get(p) !== key) {
					lastInventories[r]!.set(p, key);
					inventories[r]!.push(ticks.tick[i]!, p, items.length, ...items);
				}
			}

			const agent = agentName(ticks.agent_skin[i]);
			if (agent && !agents[r]!.has(p)) agents[r]!.set(p, agent);
			const item = num(ticks.m_iItemDefinitionIndex[i]);
			const itemKey = itemWeaponKey(item);
			if (itemKey && itemKey === weaponKey(weaponName)) {
				const owned = num(ticks.m_iItemIDLow[i]) !== 0 || num(ticks.m_iItemIDHigh[i]) !== 0;
				const paint = owned && itemKey !== 'knife' ? num(ticks.weapon_skin_id[i]) : 0;
				const previous = lastSkins[r]!.get(p) ?? -1;
				let skin = owned && previous >= 0 && skinLists[r]![previous]!.item === item ? previous : -1;
				if (paint > 0) {
					const entry: ReplaySkin = {
						item,
						paint,
						seed: num(ticks.weapon_paint_seed[i]),
						wear: Math.round(num(ticks.weapon_float[i]) * 1e6) / 1e6
					};
					const id = `${entry.item}:${entry.paint}:${entry.seed}:${entry.wear}`;
					skin = skinTables[r]!.get(id) ?? -1;
					if (skin < 0) {
						skin = skinLists[r]!.push(entry) - 1;
						skinTables[r]!.set(id, skin);
					}
				}
				if (previous !== skin) {
					lastSkins[r]!.set(p, skin);
					skinChanges[r]!.push(ticks.tick[i]!, p, skin);
				}
			}
			cols.flags[at] =
				FLAG_PRESENT |
				(bool(ticks.is_alive[i]) ? FLAG_ALIVE : 0) |
				(bool(ticks.has_helmet[i]) ? FLAG_HELMET : 0) |
				(bool(ticks.has_defuser[i]) ? FLAG_DEFUSER : 0) |
				(bool(ticks.is_defusing[i]) ? FLAG_DEFUSING : 0) |
				(bool(ticks.is_scoped[i]) ? FLAG_SCOPED : 0) |
				(num(ticks.duck_amount[i]) > 0.5 ? FLAG_DUCKING : 0);
		}
	}

	grids.forEach((grid, r) => fillGaps(columns[r]!, roundPlayers[r]!.length, grid.count));
	markBombCarriers(events, spans, grids, columns, playerIndex);

	const eventsByRound = spans.map(() => [] as RawEvent[]);
	for (const event of events) {
		const r = roundIndexForTick(event.tick);
		if (r >= 0) eventsByRound[r]!.push(event);
	}

	const grenadeRows = parseGrenades(path);
	timings('grenades');
	const settingTicks = spans.map((span) =>
		Math.min(span.lastTick, (span.freezeEndTick ?? span.startTick) + 32)
	);
	let roundSettings: Map<string, PlayerSettings>[] = spans.map(() => new Map());
	let gloves = new Map<string, ReplaySkin>();
	try {
		const rows = parseSettings(
			path,
			[...new Set(settingTicks)].sort((a, b) => a - b)
		);
		roundSettings = settingTicks.map((tick) => settingsAt(rows, tick, playerKey));
		gloves = glovesBySteamId(parseSkins(path));
	} catch (error) {
		console.warn(`No player settings: ${error instanceof Error ? error.message : error}`);
	}
	timings('settings');
	let views: ({ grid: Grid; columns: ViewColumns } | null)[] = spans.map(() => null);
	const viewRate = options.viewRate ?? 32;
	let viewStep = Math.max(1, Math.round(tickRate / Math.max(1, viewRate)));
	if (viewRate > 0) {
		try {
			if (viewStep === 1) viewStep = probeSnapshotStep(path, spans);
			views = buildViews(
				path,
				spans,
				playerIndex,
				roundPlayers.map((list) => list.length),
				viewStep
			);
		} catch (error) {
			console.warn(`No view stream: ${error instanceof Error ? error.message : error}`);
		}
	}
	timings('view');
	const grenadesByRound = buildGrenades(grenadeRows, events, roundIndexForTick, indexOf);

	const siteOf = (round: number, event: RawEvent): string | null => {
		const p = indexOf(round, event.user_steamid, event.user_name);
		const grid = grids[round]!;
		if (p < 0) return null;
		const frame = Math.max(
			0,
			Math.min(grid.count - 1, Math.round((event.tick - grid.first) / STEP))
		);
		const zoneTick = grid.first + frame * STEP;
		for (let i = 0; i < ticks.tick.length; i++) {
			if (ticks.tick[i] !== zoneTick) continue;
			if (playerKey(ticks.steamid[i], ticks.name[i]) !== roundPlayers[round]![p]!.key) continue;
			const zone = num(ticks.which_bomb_zone[i]);
			return zone === 1 ? 'A' : zone === 2 ? 'B' : null;
		}
		return null;
	};

	let scoreA = 0;
	let scoreB = 0;
	const roundRows: Omit<NewRound, 'demoId'>[] = [];
	const killRows: Omit<NewKill, 'demoId'>[] = [];
	const replays: RoundReplay[] = spans.map((span, r) => {
		const roundEvents = eventsByRound[r]!;
		const teamASide = teamASides[r]!;
		const winnerTeam: TeamKey | null = span.winner ? (span.winner === teamASide ? 'a' : 'b') : null;
		if (winnerTeam === 'a') scoreA++;
		if (winnerTeam === 'b') scoreB++;

		roundRows.push({
			number: span.number,
			startTick: span.startTick,
			freezeEndTick: span.freezeEndTick,
			endTick: span.endTick,
			teamASide,
			winnerSide: span.winner,
			winnerTeam,
			reason: span.reason,
			scoreA,
			scoreB
		});

		const kills = roundEvents
			.filter((e) => e.event_name === 'player_death')
			.map((e): ReplayKill => {
				killRows.push({
					round: span.number,
					tick: e.tick,
					attackerSteamid: str(e.attacker_steamid)
						? playerKey(e.attacker_steamid, e.attacker_name)
						: null,
					victimSteamid: playerKey(e.user_steamid, e.user_name),
					assisterSteamid: str(e.assister_steamid)
						? playerKey(e.assister_steamid, e.assister_name)
						: null,
					weapon: str(e.weapon) ?? 'world',
					headshot: bool(e.headshot),
					wallbang: num(e.penetrated) > 0,
					throughSmoke: bool(e.thrusmoke),
					noScope: bool(e.noscope),
					attackerBlind: bool(e.attackerblind),
					flashAssist: bool(e.assistedflash)
				});
				return {
					tick: e.tick,
					attacker: indexOf(r, e.attacker_steamid, e.attacker_name),
					victim: indexOf(r, e.user_steamid, e.user_name),
					assister: indexOf(r, e.assister_steamid, e.assister_name),
					weapon: str(e.weapon) ?? 'world',
					headshot: bool(e.headshot),
					wallbang: num(e.penetrated) > 0,
					throughSmoke: bool(e.thrusmoke),
					noScope: bool(e.noscope),
					attackerBlind: bool(e.attackerblind),
					flashAssist: bool(e.assistedflash),
					x: Math.round(num(e.user_X)),
					y: Math.round(num(e.user_Y)),
					z: Math.round(num(e.user_Z))
				};
			});

		const shots: number[] = [];
		const swings: number[] = [];
		const reloads: number[] = [];
		for (const e of roundEvents) {
			if (e.event_name !== 'weapon_fire' && e.event_name !== 'weapon_reload') continue;
			const p = indexOf(r, e.user_steamid, e.user_name);
			if (p < 0) continue;
			if (e.event_name === 'weapon_reload') reloads.push(e.tick, p);
			else if (isGun(str(e.weapon))) shots.push(e.tick, p);
			else if (isKnife(str(e.weapon))) swings.push(e.tick, p);
		}

		const blinds = roundEvents
			.filter((e) => e.event_name === 'player_blind' && num(e.blind_duration) > 0)
			.map((e) => ({
				tick: e.tick,
				player: indexOf(r, e.user_steamid, e.user_name),
				attacker: indexOf(r, e.attacker_steamid, e.attacker_name),
				duration: Math.round(num(e.blind_duration) * 100) / 100
			}))
			.filter((b) => b.player >= 0);

		const view = views[r];
		const hurts: number[] = [];
		for (const e of roundEvents) {
			if (e.event_name !== 'player_hurt') continue;
			const victim = indexOf(r, e.user_steamid, e.user_name);
			if (victim < 0) continue;
			hurts.push(
				e.tick,
				victim,
				indexOf(r, e.attacker_steamid, e.attacker_name),
				Math.round(num(e.dmg_health)),
				Math.round(num(e.dmg_armor)),
				e.hitgroup === 'head' ? 1 : 0
			);
		}

		const bomb = buildBombEvents(
			roundEvents,
			(e) => indexOf(r, e.user_steamid, e.user_name),
			(e) => siteOf(r, e)
		);

		return {
			meta: {
				version: REPLAY_VERSION,
				round: span.number,
				tickRate,
				tickStep: STEP,
				startTick: grids[r]!.first,
				frameCount: grids[r]!.count,
				freezeEndTick: span.freezeEndTick,
				endTick: span.endTick,
				winner: span.winner,
				reason: span.reason,
				scoreA,
				scoreB,
				players: roundPlayers[r]!.map((entry, p) => ({
					...(agents[r]!.has(p) ? { agent: agents[r]!.get(p) } : {}),
					...roundSettings[r]!.get(entry.key),
					...(gloves.has(entry.key) ? { gloves: gloves.get(entry.key) } : {}),
					steamid: entry.key,
					name: entry.name,
					team: teamOf(entry),
					side: (() => {
						const counts = entry.sideRows.get(r)!;
						return counts[0] >= counts[1] ? 'CT' : 'T';
					})()
				})),
				weapons: [...weaponTables[r]!.keys()],
				kills,
				shots,
				swings,
				reloads,
				skins: skinLists[r]!,
				skinChanges: skinChanges[r]!,
				grenades: grenadesByRound.paths[r] ?? [],
				effects: buildEffects(
					roundEvents,
					(e) => indexOf(r, e.user_steamid, e.user_name),
					tickRate
				),
				bomb,
				blinds,
				inventory: inventories[r]!,
				hurts,
				places: [...placeTables[r]!.keys()],
				...(view
					? {
							view: {
								tickStep: viewStep,
								startTick: view.grid.first,
								frameCount: view.grid.count
							}
						}
					: {})
			},
			columns: columns[r]!,
			...(view ? { view: view.columns } : {})
		};
	});

	const playerRows = [...players.values()].map((entry) => ({
		steamid: entry.key,
		name: entry.name,
		team: teamOf(entry),
		kills: num(ticks.kills_total[entry.lastRow]),
		deaths: num(ticks.deaths_total[entry.lastRow]),
		assists: num(ticks.assists_total[entry.lastRow]),
		damage: num(ticks.damage_total[entry.lastRow]),
		headshotKills: num(ticks.headshot_kills_total[entry.lastRow]),
		mvps: num(ticks.mvps[entry.lastRow]),
		score: num(ticks.score[entry.lastRow])
	}));

	const teamName = (team: TeamKey): string | null => {
		const counts = new Map<string, number>();
		for (const entry of players.values()) {
			if (teamOf(entry) !== team) continue;
			const name = str(ticks.team_clan_name[entry.lastRow]);
			if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	};

	const lastSpan = spans.at(-1)!;
	return {
		map: header.map_name,
		serverName: header.server_name ?? '',
		platform: detectPlatform(header.server_name ?? ''),
		tickRate,
		durationSeconds: Math.round((lastSpan.endTick - spans[0]!.startTick) / tickRate),
		scoreA,
		scoreB,
		teamAName: teamName('a'),
		teamBName: teamName('b'),
		teamAStartSide: teamASides[0]!,
		players: playerRows,
		rounds: roundRows,
		kills: killRows,
		replays
	};
}

function agentName(value: unknown): string | null {
	const name = str(value)?.replace(/^customplayer_/, '');
	if (!name || name.endsWith('map_based')) return null;
	return /^[a-z0-9_]+$/.test(name) ? name : null;
}

function isKnife(weapon: string | null): boolean {
	return weapon !== null && /knife|bayonet/.test(weapon);
}

function isGun(weapon: string | null): boolean {
	if (!weapon) return false;
	const name = weapon.replace(/^weapon_/, '');
	return !/^(knife|bayonet|c4|flashbang|smokegrenade|hegrenade|molotov|incgrenade|decoy)/.test(
		name
	);
}

export function snapshotStep(
	rows: Pick<ViewRows, 'tick' | 'steamid' | 'name' | 'X' | 'Y' | 'yaw'>
): number {
	const last = new Map<string, string>();
	const changes = [0, 0];
	const order = rows.tick.map((_, i) => i).sort((a, b) => rows.tick[a]! - rows.tick[b]!);
	for (const i of order) {
		const key = playerKey(rows.steamid[i], rows.name[i]);
		const value = `${num(rows.X[i])},${num(rows.Y[i])},${num(rows.yaw[i])}`;
		const previous = last.get(key);
		if (previous !== undefined && previous !== value) changes[rows.tick[i]! % 2]!++;
		last.set(key, value);
	}
	const [even, odd] = changes as [number, number];
	return even > 20 && odd * 8 < even ? 2 : 1;
}

function probeSnapshotStep(path: string, spans: RoundSpan[]): number {
	const span = spans.reduce((a, b) =>
		b.lastTick - b.startTick > a.lastTick - a.startTick ? b : a
	);
	const middle = Math.floor((span.startTick + span.lastTick) / 2);
	const ticks = Array.from({ length: 64 }, (_, i) => middle + i);
	return snapshotStep(parseView(path, ticks));
}

function buildViews(
	path: string,
	spans: RoundSpan[],
	playerIndex: Map<string, number>[],
	playerCounts: number[],
	step: number
): { grid: Grid; columns: ViewColumns }[] {
	const grids = spans.map((span) => gridFor(span, step));
	const views = grids.map((grid, r) => ({
		grid,
		columns: createViewColumns(playerCounts[r]! * grid.count),
		present: new Uint8Array(playerCounts[r]! * grid.count)
	}));
	const wanted = new Set<number>();
	for (const grid of grids) for (let f = 0; f < grid.count; f++) wanted.add(grid.first + f * step);
	const rows = parseView(
		path,
		[...wanted].sort((a, b) => a - b)
	);

	for (let i = 0; i < rows.tick.length; i++) {
		const tick = rows.tick[i]!;
		const key = playerKey(rows.steamid[i], rows.name[i]);
		for (let r = 0; r < views.length; r++) {
			const { grid, columns, present } = views[r]!;
			if (tick < grid.first || tick > grid.first + (grid.count - 1) * step) continue;
			const p = playerIndex[r]!.get(key);
			if (p === undefined) continue;
			const at = p * grid.count + (tick - grid.first) / step;
			const punch = Array.isArray(rows.aim_punch_angle[i])
				? (rows.aim_punch_angle[i] as unknown[])
				: [];
			columns.x[at] = clamp32(num(rows.X[i]) * VIEW_POSITION_SCALE);
			columns.y[at] = clamp32(num(rows.Y[i]) * VIEW_POSITION_SCALE);
			columns.z[at] = clamp32(num(rows.Z[i]) * VIEW_POSITION_SCALE);
			columns.yaw[at] = packYaw(num(rows.yaw[i]));
			columns.pitch[at] = clamp16(packPitch(num(rows.pitch[i])));
			columns.punchPitch[at] = clamp16(num(punch[0]) * PUNCH_SCALE);
			columns.punchYaw[at] = clamp16(num(punch[1]) * PUNCH_SCALE);
			columns.duck[at] = clampU8(num(rows.duck_amount[i]) * 255);
			present[at] = 1;
		}
	}

	for (const { grid, columns, present } of views) {
		const keys = Object.keys(columns) as (keyof ViewColumns)[];
		for (let p = 0; p < present.length / grid.count; p++) {
			const start = p * grid.count;
			let source = -1;
			for (let f = 0; f < grid.count && source < 0; f++) if (present[start + f]) source = start + f;
			if (source < 0) continue;
			for (let f = 0; f < grid.count; f++) {
				const at = start + f;
				if (present[at]) source = at;
				else for (const key of keys) columns[key][at] = columns[key][source]!;
			}
		}
	}
	return views.map(({ grid, columns }) => ({ grid, columns }));
}

function fillGaps(cols: RoundColumns, playerCount: number, frames: number) {
	for (let p = 0; p < playerCount; p++) {
		const start = p * frames;
		let source = -1;
		for (let f = 0; f < frames; f++) {
			if (cols.flags[start + f]! & FLAG_PRESENT) {
				source = start + f;
				break;
			}
		}
		if (source < 0) continue;
		for (let f = 0; f < frames; f++) {
			const at = start + f;
			if (cols.flags[at]! & FLAG_PRESENT) {
				source = at;
				continue;
			}
			cols.x[at] = cols.x[source]!;
			cols.y[at] = cols.y[source]!;
			cols.z[at] = cols.z[source]!;
			cols.yaw[at] = cols.yaw[source]!;
			cols.pitch[at] = cols.pitch[source]!;
			cols.money[at] = cols.money[source]!;
		}
	}
}

function markBombCarriers(
	events: RawEvent[],
	spans: RoundSpan[],
	grids: Grid[],
	columns: RoundColumns[],
	playerIndex: Map<string, number>[]
) {
	const intervals: { key: string; from: number; to: number }[] = [];
	let carrier: { key: string; from: number } | null = null;
	const close = (tick: number) => {
		if (carrier) intervals.push({ ...carrier, to: tick });
		carrier = null;
	};

	const bombEvents = events
		.filter((e) => ['bomb_pickup', 'bomb_dropped', 'bomb_planted'].includes(e.event_name))
		.sort((a, b) => a.tick - b.tick);
	for (const e of bombEvents) {
		if (e.event_name === 'bomb_pickup') {
			close(e.tick);
			if (str(e.user_steamid) || str(e.user_name))
				carrier = { key: playerKey(e.user_steamid, e.user_name), from: e.tick };
		} else {
			close(e.tick);
		}
	}
	close(Number.MAX_SAFE_INTEGER);

	spans.forEach((_, r) => {
		const grid = grids[r]!;
		const cols = columns[r]!;
		const end = grid.first + (grid.count - 1) * STEP;
		for (const interval of intervals) {
			if (interval.to < grid.first || interval.from > end) continue;
			const p = playerIndex[r]!.get(interval.key);
			if (p === undefined) continue;
			const fromFrame = Math.max(0, Math.ceil((interval.from - grid.first) / STEP));
			const toFrame = Math.min(grid.count - 1, Math.floor((interval.to - 1 - grid.first) / STEP));
			for (let f = fromFrame; f <= toFrame; f++) cols.flags[p * grid.count + f]! |= FLAG_BOMB;
		}
	});
}

const bombTypes: Record<string, BombEventType> = {
	bomb_pickup: 'pickup',
	bomb_dropped: 'drop',
	bomb_beginplant: 'plant_start',
	bomb_planted: 'plant',
	bomb_begindefuse: 'defuse_start',
	bomb_defused: 'defuse',
	bomb_exploded: 'explode'
};

function buildBombEvents(
	events: RawEvent[],
	playerOf: (e: RawEvent) => number,
	siteOf: (e: RawEvent) => string | null
): ReplayBombEvent[] {
	let plant: ReplayBombEvent | null = null;
	const result: ReplayBombEvent[] = [];
	for (const e of events) {
		const type = bombTypes[e.event_name];
		if (!type) continue;
		if (type === 'pickup' && !str(e.user_steamid) && !str(e.user_name)) continue;
		const atPlant = (type === 'defuse' || type === 'explode') && plant;
		const event: ReplayBombEvent = {
			type,
			tick: e.tick,
			player: playerOf(e),
			x: atPlant ? plant!.x : Math.round(num(e.user_X)),
			y: atPlant ? plant!.y : Math.round(num(e.user_Y)),
			z: atPlant ? plant!.z : Math.round(num(e.user_Z)),
			site: type === 'plant' ? siteOf(e) : (plant?.site ?? null)
		};
		if (type === 'plant') plant = event;
		result.push(event);
	}
	return result;
}

function buildEffects(
	events: RawEvent[],
	playerOf: (e: RawEvent) => number,
	tickRate: number
): ReplayEffect[] {
	const seconds = (s: number) => Math.round(s * tickRate);
	const endOf = (type: string, entity: number, from: number, fallback: number) =>
		events.find((e) => e.event_name === type && num(e.entityid, -1) === entity && e.tick >= from)
			?.tick ?? fallback;

	const effects: ReplayEffect[] = [];
	for (const e of events) {
		const base = {
			thrower: playerOf(e),
			startTick: e.tick,
			x: Math.round(num(e.x)),
			y: Math.round(num(e.y)),
			z: Math.round(num(e.z))
		};
		const entity = num(e.entityid, -1);
		switch (e.event_name) {
			case 'smokegrenade_detonate':
				effects.push({
					...base,
					type: 'smoke',
					endTick: endOf('smokegrenade_expired', entity, e.tick, e.tick + seconds(20))
				});
				break;
			case 'inferno_startburn':
				effects.push({
					...base,
					type: 'molotov',
					endTick: endOf('inferno_expire', entity, e.tick, e.tick + seconds(7))
				});
				break;
			case 'flashbang_detonate':
				effects.push({ ...base, type: 'flash', endTick: e.tick + seconds(0.4) });
				break;
			case 'hegrenade_detonate':
				effects.push({ ...base, type: 'he', endTick: e.tick + seconds(0.5) });
				break;
			case 'decoy_started':
				effects.push({ ...base, type: 'decoy', endTick: e.tick + seconds(15) });
				break;
		}
	}
	return effects;
}

const projectileTypes: Record<string, GrenadeType> = {
	CSmokeGrenadeProjectile: 'smoke',
	CFlashbangProjectile: 'flash',
	CHEGrenadeProjectile: 'he',
	CMolotovProjectile: 'molotov',
	CDecoyProjectile: 'decoy'
};

const detonationEvents: Record<GrenadeType, string | null> = {
	smoke: 'smokegrenade_detonate',
	flash: 'flashbang_detonate',
	he: 'hegrenade_detonate',
	molotov: null,
	decoy: 'decoy_started'
};

function buildGrenades(
	rows: RawGrenade[],
	events: RawEvent[],
	roundIndexForTick: (tick: number) => number,
	indexOf: (round: number, steamid: unknown, name: unknown) => number
) {
	const detonations = new Map<string, number[]>();
	for (const e of events) {
		const entity = num(e.entityid, -1);
		if (entity < 0) continue;
		const key = `${e.event_name}:${entity}`;
		detonations.set(key, [...(detonations.get(key) ?? []), e.tick]);
	}

	const sorted = rows
		.filter((row) => row.x !== null && row.y !== null && projectileTypes[row.grenade_type])
		.sort((a, b) => a.grenade_entity_id - b.grenade_entity_id || a.tick - b.tick);

	const paths: ReplayGrenade[][] = [];
	let segment: RawGrenade[] = [];
	const flush = () => {
		if (segment.length < 2) {
			segment = [];
			return;
		}
		const first = segment[0]!;
		const type = projectileTypes[first.grenade_type]!;
		const round = roundIndexForTick(first.tick);
		if (round >= 0) {
			const eventName = detonationEvents[type];
			const lastTick = segment.at(-1)!.tick;
			const detonatedAt = eventName
				? detonations
						.get(`${eventName}:${first.grenade_entity_id}`)
						?.find((t) => t >= first.tick && t <= lastTick + 64)
				: undefined;
			const end = detonatedAt ?? lastTick;
			const path: number[] = [];
			const points = segment.filter((row) => row.tick <= end);
			points.forEach((row, i) => {
				if (row.tick % STEP === 0 || i === points.length - 1) {
					path.push(row.tick, Math.round(row.x!), Math.round(row.y!), Math.round(row.z!));
				}
			});
			(paths[round] ??= []).push({
				type,
				thrower: indexOf(round, first.steamid, first.name),
				path
			});
		}
		segment = [];
	};

	for (const row of sorted) {
		const previous = segment.at(-1);
		if (
			previous &&
			(previous.grenade_entity_id !== row.grenade_entity_id || row.tick - previous.tick > 32)
		)
			flush();
		segment.push(row);
	}
	flush();

	return { paths };
}
