import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitDataBlocks } from './vrf.ts';

test('splits DATA blocks printed for several files', () => {
	const blocks = splitDataBlocks(`--- Files in package:
[2/3] a.vmat_c
	Resource Type: Material
--- Data for block "DATA" ---
{ m_a = 1 }
[3/3] b.vcompmat_c
--- Data for block "DATA" ---
{ m_b = 2 }
`);
	assert.deepEqual(
		[...blocks],
		[
			['a.vmat_c', '{ m_a = 1 }'],
			['b.vcompmat_c', '{ m_b = 2 }']
		]
	);
});
