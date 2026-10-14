import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MatchHistoryError, fetchNextShareCode } from './match-history.ts';

const query = {
	apiKey: 'KEY',
	steamId: '76561198056395137',
	authCode: 'ABCD-EFGHJ-KLMN',
	knownCode: 'CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK'
};

function respond(status: number, body?: unknown): typeof fetch {
	return async () => new Response(body === undefined ? null : JSON.stringify(body), { status });
}

test('sends the documented query parameters', async () => {
	let requested: URL | undefined;
	await fetchNextShareCode(query, async (url) => {
		requested = new URL(String(url));
		return new Response(null, { status: 202 });
	});

	assert.equal(requested?.pathname, '/ICSGOPlayers_730/GetNextMatchSharingCode/v1');
	assert.equal(requested?.searchParams.get('steamidkey'), 'ABCD-EFGHJ-KLMN');
	assert.equal(requested?.searchParams.get('knowncode'), query.knownCode);
});

test('returns the next code, or latest when there is none', async () => {
	assert.deepEqual(
		await fetchNextShareCode(query, respond(200, { result: { nextcode: 'CSGO-x' } })),
		{
			kind: 'next',
			code: 'CSGO-x'
		}
	);
	assert.deepEqual(await fetchNextShareCode(query, respond(202, { result: { nextcode: 'n/a' } })), {
		kind: 'latest'
	});
	assert.deepEqual(await fetchNextShareCode(query, respond(200, { result: { nextcode: 'n/a' } })), {
		kind: 'latest'
	});
});

test('maps error statuses to kinds', async () => {
	const kindOf = async (status: number) => {
		const error = await fetchNextShareCode(query, respond(status)).catch((e: unknown) => e);
		assert.ok(error instanceof MatchHistoryError, `status ${status}`);
		return error.kind;
	};

	assert.equal(await kindOf(403), 'auth');
	assert.equal(await kindOf(412), 'known-code');
	assert.equal(await kindOf(429), 'rate-limit');
	assert.equal(await kindOf(503), 'rate-limit');
	assert.equal(await kindOf(500), 'temporary');
	const offline = await fetchNextShareCode(query, async () => {
		throw new Error('ECONNRESET');
	}).catch((e: MatchHistoryError) => e);
	assert.equal(offline.kind, 'temporary');
});
