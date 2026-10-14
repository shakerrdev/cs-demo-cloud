import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthCode, parseShareCode, parseSteamId, vanityName } from './steam.ts';

test('decodes a match share code to its match id', () => {
	assert.deepEqual(parseShareCode(' CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK '), {
		code: 'CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK',
		matchId: '3230642215713767580'
	});
});

test('accepts the steam:// download link Steam shows next to a match', () => {
	assert.equal(
		parseShareCode(
			'steam://rungame/730/76561202255233023/+csgo_download_match%20CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK'
		)?.matchId,
		'3230642215713767580'
	);
});

test('rejects malformed share codes', () => {
	assert.equal(parseShareCode('CSGO-GADqf-jjyJ8'), null);
	assert.equal(parseShareCode('CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2x!'), null);
	assert.equal(parseShareCode('hello'), null);
});

test('recognises match history auth codes', () => {
	assert.equal(isAuthCode('ABCD-EFGHJ-KLMN'), true);
	assert.equal(isAuthCode(' abcd-efghj-klmn '), true);
	assert.equal(isAuthCode('ABCD-EFGH-KLMN'), false);
});

test('reads a SteamID64 from an id or a profile link', () => {
	assert.equal(parseSteamId('76561198056395137'), '76561198056395137');
	assert.equal(
		parseSteamId('https://steamcommunity.com/profiles/76561198056395137/'),
		'76561198056395137'
	);
	assert.equal(parseSteamId('12345'), null);
	assert.equal(vanityName('https://steamcommunity.com/id/gabelogannewell'), 'gabelogannewell');
	assert.equal(vanityName('76561198056395137'), null);
});
