import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignTeams, type TeamCandidate } from './teams.ts';

function player(key: string, sides: (string | null)[]): TeamCandidate {
	const sideRows = new Map<number, [number, number]>();
	sides.forEach((side, round) => {
		if (side === 'CT') sideRows.set(round, [30, 0]);
		if (side === 'T') sideRows.set(round, [0, 30]);
	});
	return { key, sideRows };
}

test('follows teams across halftime', () => {
	const { teams, teamASides } = assignTeams(
		[player('ct1', ['CT', 'CT', 'T', 'T']), player('t1', ['T', 'T', 'CT', 'CT'])],
		4
	);

	assert.deepEqual(teamASides, ['CT', 'CT', 'T', 'T']);
	assert.equal(teams.get('ct1'), 'a');
	assert.equal(teams.get('t1'), 'b');
});

test('keeps a player who left before halftime on their team', () => {
	const { teams } = assignTeams(
		[
			player('stays', ['CT', 'CT', 'T', 'T']),
			player('leaver', ['CT', null, null, null]),
			player('enemy', ['T', 'T', 'CT', 'CT'])
		],
		4
	);

	assert.equal(teams.get('leaver'), 'a');
	assert.equal(teams.get('enemy'), 'b');
});

test('places a late joiner by the side they play', () => {
	const { teams } = assignTeams(
		[
			player('a1', ['CT', 'CT', 'T', 'T']),
			player('b1', ['T', 'T', 'CT', 'CT']),
			player('late', [null, null, 'CT', 'CT'])
		],
		4
	);

	assert.equal(teams.get('late'), 'b');
});
