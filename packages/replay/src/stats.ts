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
		const clutching = new Map<TeamKey, { steamid: string; opponents: number }>();

		const aliveOn = (team: TeamKey) => [...alive].filter((id) => teamOf.get(id) === team);
		const checkClutch = () => {
			for (const team of ['a', 'b'] as TeamKey[]) {
				if (clutching.has(team)) continue;
				const own = aliveOn(team);
				const enemies = aliveOn(team === 'a' ? 'b' : 'a').length;
				if (own.length === 1 && enemies > 0) {
					clutching.set(team, { steamid: own[0]!, opponents: enemies });
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
			checkClutch();
		});

		for (const [team, clutch] of clutching) {
			stats.get(clutch.steamid)!.clutches.push({
				round: round.number,
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
