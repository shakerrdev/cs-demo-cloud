import type { Side } from '@cs-demo-cloud/replay';
import { bool, num, str, type RawEvent } from './parser.ts';

export interface RoundSpan {
	number: number;
	startTick: number;
	freezeEndTick: number | null;
	endTick: number;
	lastTick: number;
	winner: Side | null;
	reason: string | null;
}

const isSide = (value: unknown): value is Side => value === 'CT' || value === 'T';

export function detectRounds(
	events: RawEvent[],
	demoLastTick: number,
	tickRate: number
): RoundSpan[] {
	const byType = (name: string) =>
		events
			.filter((e) => e.event_name === name && !bool(e.is_warmup_period))
			.sort((a, b) => a.tick - b.tick);

	const decidedEnds = byType('round_end').filter((end) => isSide(end.winner));
	const matchStart = events
		.filter(
			(e) => e.event_name === 'begin_new_match' && decidedEnds.some((end) => end.tick > e.tick)
		)
		.reduce((latest, e) => Math.max(latest, e.tick), -1);

	const lastEndByRound = new Map<number, RawEvent>();
	for (const end of decidedEnds) {
		if (end.tick > matchStart) lastEndByRound.set(num(end.round), end);
	}

	const starts = byType('round_start');
	const freezeEnds = byType('round_freeze_end');
	const spans: RoundSpan[] = [];

	for (const number of [...lastEndByRound.keys()].sort((a, b) => a - b)) {
		const end = lastEndByRound.get(number)!;
		const previousEnd = spans.at(-1)?.endTick ?? matchStart - tickRate;
		const candidates = starts.filter((s) => s.tick > previousEnd && s.tick <= end.tick);
		const start = candidates.findLast((s) => num(s.round) === number) ?? candidates.at(-1);
		const startTick = start?.tick ?? Math.max(previousEnd + 1, 0);
		const freezeEnd = freezeEnds.find((f) => f.tick >= startTick && f.tick <= end.tick);

		spans.push({
			number: spans.length + 1,
			startTick,
			freezeEndTick: freezeEnd?.tick ?? null,
			endTick: end.tick,
			lastTick: end.tick,
			winner: isSide(end.winner) ? end.winner : null,
			reason: str(end.reason)
		});
	}

	const afterRound = Math.round(5 * tickRate);
	spans.forEach((span, i) => {
		const next = spans[i + 1];
		span.lastTick = next
			? Math.max(span.endTick, next.startTick)
			: Math.min(demoLastTick, span.endTick + afterRound);
	});

	return spans;
}
