import type { TeamKey } from './types.ts';

export interface StatsPlayer {
	steamid: string;
	team: TeamKey;
}

export interface StatsRound {
	number: number;
	winnerTeam: TeamKey | null;
}

export interface StatsKill {
	round: number;
	tick: number;
	attackerSteamid: string | null;
	victimSteamid: string;
	assisterSteamid: string | null;
	flashAssist: boolean;
}

export interface Clutch {
	round: number;
	tick: number;
	opponents: number;
	won: boolean;
}

export interface PlayerStats {
	steamid: string;
	rounds: number;
	kastRounds: number;
	kast: number;
	openingKills: number;
	openingDeaths: number;
	trades: number;
	tradedDeaths: number;
	multiKills: [number, number, number, number];
	clutches: Clutch[];
	flashAssists: number;
}

export interface MatchStats {
	players: PlayerStats[];
	openings: { round: number; team: TeamKey }[];
}

export const TRADE_SECONDS = 5;

export function matchStats(
	players: StatsPlayer[],
	rounds: StatsRound[],
	kills: StatsKill[],
	tickRate: number
): MatchStats {
	const teamOf = new Map(players.map((p) => [p.steamid, p.team]));
	const stats = new Map<string, PlayerStats>(
		players.map((p) => [
			p.steamid,
			{
				steamid: p.steamid,
				rounds: rounds.length,
				kastRounds: 0,
				kast: 0,
				openingKills: 0,
				openingDeaths: 0,
				trades: 0,
				tradedDeaths: 0,
				multiKills: [0, 0, 0, 0],
				clutches: [],
				flashAssists: 0
			}
		])
	);
	const tradeWindow = TRADE_SECONDS * tickRate;
	const openings: MatchStats['openings'] = [];

	for (const round of rounds) {
		const roundKills = kills
			.filter((k) => k.round === round.number)
			.sort((a, b) => a.tick - b.tick);
		const alive = new Set(players.map((p) => p.steamid));
		const killCount = new Map<string, number>();
		const assisted = new Set<string>();
		const traded = new Set<string>();
		const clutching = new Map<TeamKey, { steamid: string; opponents: number; tick: number }>();

		const aliveOn = (team: TeamKey) => [...alive].filter((id) => teamOf.get(id) === team);
		const checkClutch = (tick: number) => {
			for (const team of ['a', 'b'] as TeamKey[]) {
				if (clutching.has(team)) continue;
				const own = aliveOn(team);
				const enemies = aliveOn(team === 'a' ? 'b' : 'a').length;
				if (own.length === 1 && enemies > 0) {
					clutching.set(team, { steamid: own[0]!, opponents: enemies, tick });
				}
			}
		};

		let opened = false;
		roundKills.forEach((kill, index) => {
			const victimTeam = teamOf.get(kill.victimSteamid);
			const attackerTeam = kill.attackerSteamid ? teamOf.get(kill.attackerSteamid) : undefined;
			const enemyKill = Boolean(attackerTeam && victimTeam && attackerTeam !== victimTeam);

			if (enemyKill && !opened) {
				opened = true;
				stats.get(kill.attackerSteamid!)!.openingKills++;
				const victim = stats.get(kill.victimSteamid);
				if (victim) victim.openingDeaths++;
				openings.push({ round: round.number, team: attackerTeam! });
			}

			if (enemyKill) {
				const attacker = kill.attackerSteamid!;
				killCount.set(attacker, (killCount.get(attacker) ?? 0) + 1);
				const avenged = roundKills
					.slice(0, index)
					.reverse()
					.find(
						(earlier) =>
							kill.tick - earlier.tick <= tradeWindow &&
							earlier.attackerSteamid === kill.victimSteamid &&
							teamOf.get(earlier.victimSteamid) === attackerTeam &&
							earlier.victimSteamid !== attacker
					);
				if (avenged) {
					stats.get(attacker)!.trades++;
					if (!traded.has(avenged.victimSteamid)) {
						traded.add(avenged.victimSteamid);
						const tradedVictim = stats.get(avenged.victimSteamid);
						if (tradedVictim) tradedVictim.tradedDeaths++;
					}
				}
				if (kill.assisterSteamid && teamOf.get(kill.assisterSteamid) === attackerTeam) {
					assisted.add(kill.assisterSteamid);
					if (kill.flashAssist) {
						const assister = stats.get(kill.assisterSteamid);
						if (assister) assister.flashAssists++;
					}
				}
			}

			alive.delete(kill.victimSteamid);
			checkClutch(kill.tick);
		});

		for (const [team, clutch] of clutching) {
			stats.get(clutch.steamid)!.clutches.push({
				round: round.number,
				tick: clutch.tick,
				opponents: clutch.opponents,
				won: round.winnerTeam === team
			});
		}

		for (const player of stats.values()) {
			const k = killCount.get(player.steamid) ?? 0;
			if (k >= 2) player.multiKills[Math.min(k, 5) - 2]!++;
			if (
				k > 0 ||
				assisted.has(player.steamid) ||
				alive.has(player.steamid) ||
				traded.has(player.steamid)
			) {
				player.kastRounds++;
			}
		}
	}

	for (const player of stats.values()) {
		player.kast = player.rounds ? player.kastRounds / player.rounds : 0;
	}
	return { players: [...stats.values()], openings };
}

export type Highlight =
	| { kind: 'multi'; steamid: string; round: number; tick: number; kills: number }
	| { kind: 'clutch'; steamid: string; round: number; tick: number; opponents: number };

export function matchHighlights(
	players: StatsPlayer[],
	kills: StatsKill[],
	stats: MatchStats,
	minKills = 3,
	minOpponents = 2
): Highlight[] {
	const teamOf = new Map(players.map((p) => [p.steamid, p.team]));
	const multi = new Map<string, { steamid: string; round: number; tick: number; kills: number }>();
	for (const kill of kills) {
		const attacker = kill.attackerSteamid;
		if (!attacker) continue;
		const team = teamOf.get(attacker);
		if (!team || team === teamOf.get(kill.victimSteamid)) continue;
		const key = `${kill.round}:${attacker}`;
		const entry = multi.get(key) ?? {
			steamid: attacker,
			round: kill.round,
			tick: kill.tick,
			kills: 0
		};
		entry.kills++;
		entry.tick = Math.min(entry.tick, kill.tick);
		multi.set(key, entry);
	}
	const highlights: Highlight[] = [...multi.values()]
		.filter((entry) => entry.kills >= minKills)
		.map((entry) => ({ kind: 'multi', ...entry }));
	for (const player of stats.players) {
		for (const clutch of player.clutches) {
			if (!clutch.won || clutch.opponents < minOpponents) continue;
			highlights.push({
				kind: 'clutch',
				steamid: player.steamid,
				round: clutch.round,
				tick: clutch.tick,
				opponents: clutch.opponents
			});
		}
	}
	return highlights.sort((a, b) => a.round - b.round || a.tick - b.tick);
}
