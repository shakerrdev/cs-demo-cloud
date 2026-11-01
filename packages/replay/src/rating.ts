export interface RatingInput {
	rounds: number;
	kills: number;
	deaths: number;
	assists: number;
	damage: number;
	kast: number;
}

export function rating({ rounds, kills, deaths, assists, damage, kast }: RatingInput): number {
	if (rounds <= 0) return 0;
	const kpr = kills / rounds;
	const dpr = deaths / rounds;
	const apr = assists / rounds;
	const adr = damage / rounds;
	const impact = 2.13 * kpr + 0.42 * apr - 0.41;
	const value =
		0.0073 * kast * 100 + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587;
	return Math.max(0, Math.round(value * 100) / 100);
}
