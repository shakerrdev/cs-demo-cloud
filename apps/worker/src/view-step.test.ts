import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotStep } from './analyze.ts';

function rows(changeOnOdd: boolean) {
	const out = {
		tick: [] as number[],
		steamid: [] as string[],
		name: [] as string[],
		X: [] as unknown[],
		Y: [] as unknown[],
		yaw: [] as unknown[]
	};
	for (let p = 0; p < 10; p++) {
		let x = 0;
		for (let t = 1000; t < 1064; t++) {
			if (t % 2 === 0 || changeOnOdd) x += 3;
			out.tick.push(t);
			out.steamid.push(String(7656119 + p));
			out.name.push(`p${p}`);
			out.X.push(x);
			out.Y.push(0);
			out.yaw.push(0);
		}
	}
	return out;
}

test('detects demos that only have a snapshot every second tick', () => {
	assert.equal(snapshotStep(rows(true)), 1);
	assert.equal(snapshotStep(rows(false)), 2);
});
