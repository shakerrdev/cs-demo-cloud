import type { Side, TeamKey } from './types.ts';

export type BuyType = 'pistol' | 'eco' | 'semi' | 'force' | 'full';

export interface EconomyRound {
	number: number;
	teamASide: Side;
	teamAEquipment: number | null;
	teamBEquipment: number | null;
}

export const buyLabels: Record<BuyType, string> = {
	pistol: 'Pistol',
	eco: 'Eco',
	semi: 'Semi-eco',
	force: 'Force buy',
	full: 'Full buy'
};

export function buyType(equipment: number, players = 5): Exclude<BuyType, 'pistol'> {
	const each = equipment / Math.max(1, players);
	if (each < 1200) return 'eco';
	if (each < 2800) return 'semi';
	if (each < 4200) return 'force';
	return 'full';
}

export function pistolRounds(rounds: Pick<EconomyRound, 'number' | 'teamASide'>[]): Set<number> {
	const pistols = new Set<number>();
	rounds.forEach((round, i) => {
		const previous = rounds[i - 1];
		if (!previous || (previous.teamASide !== round.teamASide && round.number <= 24)) {
			pistols.add(round.number);
		}
	});
	return pistols;
}

export function roundBuys(
	rounds: EconomyRound[],
	players = 5
): Map<number, Record<TeamKey, BuyType> | null> {
	const pistols = pistolRounds(rounds);
	return new Map<number, Record<TeamKey, BuyType> | null>(
		rounds.map((round): [number, Record<TeamKey, BuyType> | null] => {
			if (round.teamAEquipment === null || round.teamBEquipment === null)
				return [round.number, null];
			if (pistols.has(round.number)) return [round.number, { a: 'pistol', b: 'pistol' }];
			return [
				round.number,
				{ a: buyType(round.teamAEquipment, players), b: buyType(round.teamBEquipment, players) }
			];
		})
	);
}
