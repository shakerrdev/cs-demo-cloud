import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKv3 } from './kv3.ts';

test('parses the kv3 text that Source 2 Viewer prints', () => {
	const value =
		parseKv3(`<!-- kv3 encoding:text:version{e21c7f3c} format:generic:version{7412167c} -->
{
	m_bHasBloomParams = true
	m_bloomParams =
	{
		m_blendMode = "BLOOM_BLEND_SCREEN"
		m_flBloomThreshold = 1.974
		m_flBlurWeight =
		[
			0.2, 0.2, 0.2, 0.2,
			0.2,
		]
		m_vBlurTint = [ [ 1.0, 0.5, 0.25 ] ]
	}
	m_lightMaps = [ resource_name:"maps/x/lightmaps/irradiance.vtex" ]
	m_data = #[ 00 FF 10 ]
	m_name = null
}`);
	assert.deepEqual(value, {
		m_bHasBloomParams: true,
		m_bloomParams: {
			m_blendMode: 'BLOOM_BLEND_SCREEN',
			m_flBloomThreshold: 1.974,
			m_flBlurWeight: [0.2, 0.2, 0.2, 0.2, 0.2],
			m_vBlurTint: [[1, 0.5, 0.25]]
		},
		m_lightMaps: ['maps/x/lightmaps/irradiance.vtex'],
		m_data: new Uint8Array([0, 255, 16]),
		m_name: null
	});
});

test('reports the line of a syntax error', () => {
	assert.throws(() => parseKv3('{\n\ta = 1\n\tb 2\n}'), /line 3/);
});
