import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UniformRandomStream, rollPaint } from './random.ts';

test('the uniform random stream is deterministic and stays in range', () => {
	const a = new UniformRandomStream(1234);
	const b = new UniformRandomStream(1234);
	for (let i = 0; i < 100; i++) {
		const value = a.float(-2, 3);
		assert.equal(value, b.float(-2, 3));
		assert.ok(value >= -2 && value < 3);
	}
	assert.notEqual(new UniformRandomStream(1).float(0, 1), new UniformRandomStream(2).float(0, 1));
});

test('paint rolls draw one value per listed component in order', () => {
	const rolls = rollPaint(
		[
			['g_vPatternTexCoordOffset', 0, -0.14, 0.05],
			['g_vPatternTexCoordOffset', 1, 0, 0],
			['g_flPatternTexCoordRotation', 0, -45, -45]
		],
		661
	);
	const offset = rolls.get('g_vPatternTexCoordOffset')!;
	assert.ok(offset.get(0)! >= -0.14 && offset.get(0)! <= 0.05);
	assert.equal(offset.get(1), 0);
	assert.equal(rolls.get('g_flPatternTexCoordRotation')!.get(0), -45);
});
