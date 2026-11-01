import type { RoundMeta, RoundTiming } from './types.ts';

type TimingRound = Pick<RoundMeta, 'freezeEndTick' | 'endTick' | 'reason' | 'bomb'>;

function mostCommon(values: number[]): number | null {
	const counts = new Map<number, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	let best: number | null = null;
	let bestCount = 0;
	for (const [value, count] of counts) {
		if (count > bestCount || (count === bestCount && best !== null && value < best)) {
			best = value;
			bestCount = count;
		}
	}
	return best;
}

export function measureTiming(rounds: TimingRound[], tickRate: number): RoundTiming {
	const roundLengths: number[] = [];
	const bombLengths: number[] = [];
	for (const round of rounds) {
		const plant = round.bomb.find((event) => event.type === 'plant');
		const explode = round.bomb.find((event) => event.type === 'explode');
		if (plant && explode && explode.tick > plant.tick) {
			bombLengths.push(Math.round((explode.tick - plant.tick) / tickRate));
		}
		if (round.reason === 'target_saved' && !plant && round.freezeEndTick !== null) {
			roundLengths.push(Math.round((round.endTick - round.freezeEndTick) / tickRate));
		}
	}
	const roundSeconds = mostCommon(roundLengths);
	const bombSeconds = mostCommon(bombLengths);
	return {
		roundSeconds: roundSeconds && roundSeconds >= 10 ? roundSeconds : null,
		bombSeconds: bombSeconds && bombSeconds >= 5 ? bombSeconds : null
	};
}
