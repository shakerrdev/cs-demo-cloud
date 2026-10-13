import type { Side, TeamKey } from '@cs-demo-cloud/replay';

export interface TeamCandidate {
	key: string;
	sideRows: Map<number, [ct: number, t: number]>;
}

function sideInRound(entry: TeamCandidate, round: number): Side | null {
	const counts = entry.sideRows.get(round);
	if (!counts) return null;
	return counts[0] >= counts[1] ? 'CT' : 'T';
}

export function assignTeams(entries: TeamCandidate[], roundCount: number) {
	const firstGuess = new Map<string, TeamKey>();
	const teamASides: Side[] = [];

	for (let r = 0; r < roundCount; r++) {
		let teamAOnCt = 0;
		let teamAOnT = 0;
		for (const entry of entries) {
			const side = sideInRound(entry, r);
			const team = firstGuess.get(entry.key);
			if (!side || !team) continue;
			if ((side === 'CT') === (team === 'a')) teamAOnCt++;
			else teamAOnT++;
		}
		const teamASide: Side =
			teamAOnCt === 0 && teamAOnT === 0
				? r === 0
					? 'CT'
					: teamASides[r - 1]!
				: teamAOnCt >= teamAOnT
					? 'CT'
					: 'T';
		teamASides.push(teamASide);

		for (const entry of entries) {
			const side = sideInRound(entry, r);
			if (side && !firstGuess.has(entry.key))
				firstGuess.set(entry.key, side === teamASide ? 'a' : 'b');
		}
	}

	const teams = new Map<string, TeamKey>();
	for (const entry of entries) {
		let a = 0;
		let b = 0;
		for (let r = 0; r < roundCount; r++) {
			const side = sideInRound(entry, r);
			if (side === teamASides[r]) a++;
			else if (side) b++;
		}
		teams.set(entry.key, a >= b ? 'a' : 'b');
	}

	return { teamASides, teams };
}
