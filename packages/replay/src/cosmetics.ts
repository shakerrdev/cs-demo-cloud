import type { RoundReplay } from './types.ts';

export interface Cosmetics {
	agents: string[];
	paints: { item: number; paint: number }[];
}

export function collectCosmetics(replays: Pick<RoundReplay, 'meta'>[]): Cosmetics {
	return mergeCosmetics(
		replays.map(({ meta }) => ({
			agents: meta.players.flatMap((player) => (player.agent ? [player.agent] : [])),
			paints: [
				...(meta.skins ?? []).map(({ item, paint }) => ({ item, paint })),
				...meta.players.flatMap((player) =>
					player.gloves ? [{ item: player.gloves.item, paint: player.gloves.paint }] : []
				)
			]
		}))
	);
}

export function mergeCosmetics(sets: Cosmetics[]): Cosmetics {
	const agents = new Set<string>();
	const paints = new Map<string, { item: number; paint: number }>();
	for (const set of sets) {
		for (const agent of set.agents) agents.add(agent);
		for (const { item, paint } of set.paints) paints.set(`${item}:${paint}`, { item, paint });
	}
	return {
		agents: [...agents].sort(),
		paints: [...paints.values()].sort((a, b) => a.item - b.item || a.paint - b.paint)
	};
}
