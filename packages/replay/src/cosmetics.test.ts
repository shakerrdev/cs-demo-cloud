import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectCosmetics, mergeCosmetics } from './cosmetics.ts';
import type { RoundMeta } from './types.ts';

const meta = (agents: (string | undefined)[], skins: [number, number][]) =>
	({
		players: agents.map((agent) => ({ steamid: '', name: '', team: 'a', side: 'CT', agent })),
		skins: skins.map(([item, paint]) => ({ item, paint, seed: 1, wear: 0.1 }))
	}) as unknown as RoundMeta;

test('collects the agents and paint kits used in a demo once each', () => {
	const cosmetics = collectCosmetics([
		{ meta: meta(['ctm_sas_variantf', undefined], [[7, 941]]) },
		{
			meta: meta(
				['ctm_sas_variantf'],
				[
					[7, 941],
					[505, 564]
				]
			)
		}
	]);
	assert.deepEqual(cosmetics, {
		agents: ['ctm_sas_variantf'],
		paints: [
			{ item: 7, paint: 941 },
			{ item: 505, paint: 564 }
		]
	});
	assert.deepEqual(
		mergeCosmetics([cosmetics, { agents: ['tm_leet_varianta'], paints: [] }]).agents,
		['ctm_sas_variantf', 'tm_leet_varianta']
	);
});
