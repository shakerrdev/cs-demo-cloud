import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	compositePaint,
	iconCosmetics,
	materialParams,
	mergeParams,
	paintKits,
	trimParams
} from './skins.ts';

test('reads paint kits from items_game', () => {
	const kits = paintKits(`"items_game" { "paint_kits" {
		"941" { "name" "cu_ak-47_phantom_disruptor" "use_legacy_model" "1" "style" "7" "wear_remap_min" "0.000000" "wear_remap_max" "0.650000" }
		"1266" { "name" "hye_blue_m4a4" "style" "2" "composite_material_path" "weapons/paints/timed_drops/hye_blue_m4a4.vcompmat" }
	} }`);
	assert.deepEqual(kits.get(941), {
		name: 'cu_ak-47_phantom_disruptor',
		style: 7,
		legacy: true,
		wear: [0, 0.65],
		composite: null
	});
	assert.equal(kits.get(1266)?.composite, 'weapons/paints/timed_drops/hye_blue_m4a4.vcompmat');
	assert.equal(kits.get(1266)?.legacy, false);
});

test('reads material params and composite overrides', () => {
	const base = materialParams({
		m_shaderName: 'csgo_customweapon.vfx',
		m_intParams: [{ m_name: 'F_PAINT_STYLE', m_nValue: 1 }],
		m_floatParams: [{ m_name: 'g_flPatternTexCoordScale', m_flValue: 1 }],
		m_vectorParams: [{ m_name: 'g_vColor0', m_value: [0.5, 0.5, 0.5, 1] }],
		m_textureParams: [{ m_name: 'g_tPattern', m_pValue: 'default.vtex' }],
		m_stringAttributes: [{ m_name: 'composite_inputs', m_value: 'inputs.vmat' }]
	});
	assert.equal(base.strings.composite_inputs, 'inputs.vmat');
	const { material, overrides } = compositePaint({
		m_Points: [
			{
				m_vecCompositeMaterialAssemblyProcedures: [
					{
						m_vecCompositeInputContainers: [
							{
								m_nCompositeMaterialInputContainerSourceType:
									'CONTAINER_SOURCE_TYPE_SPECIFIC_MATERIAL',
								m_strSpecificContainerMaterial: 'template.vmat',
								m_strAlias: 'paint'
							},
							{
								m_nCompositeMaterialInputContainerSourceType:
									'CONTAINER_SOURCE_TYPE_LOOSE_VARIABLES',
								m_vecLooseVariables: [
									{
										m_strName: 'g_tPattern',
										m_nVariableType: 'LOOSE_VARIABLE_TYPE_RESOURCE_TEXTURE',
										m_strTextureRuntimeResourcePath: 'tiger.vtex'
									},
									{
										m_strName: 'g_flPatternTexCoordScale',
										m_nVariableType: 'LOOSE_VARIABLE_TYPE_FLOAT1',
										m_flValueFloatX: 4
									},
									{
										m_strName: 'g_vColor0',
										m_nVariableType: 'LOOSE_VARIABLE_TYPE_COLOR4',
										m_cValueColor4: [255, 0, 51]
									},
									{
										m_strName: 'g_nRandomSeed',
										m_nVariableType: 'LOOSE_VARIABLE_TYPE_INTEGER1',
										m_nValueIntX: 3
									}
								]
							}
						]
					}
				]
			}
		]
	});
	assert.equal(material, 'template.vmat');
	const merged = mergeParams(base, overrides);
	assert.equal(merged.textures.g_tPattern, 'tiger.vtex');
	assert.equal(merged.floats.g_flPatternTexCoordScale, 4);
	assert.deepEqual(merged.vectors.g_vColor0, [1, 0, 0.2, 1]);
	assert.equal(merged.ints.g_nRandomSeed, undefined);
	assert.equal(merged.ints.F_PAINT_STYLE, 1);
});

test('finds every weapon and paint kit pair from the generated icons', () => {
	const items = new Map([
		['weapon_ak47', 7],
		['weapon_knife', 42],
		['weapon_knife_karambit', 507]
	]);
	const kits = new Map([
		[
			941,
			{
				name: 'cu_ak-47_phantom_disruptor',
				style: 7,
				legacy: true,
				wear: [0, 1] as [number, number],
				composite: null
			}
		],
		[
			38,
			{
				name: 'aa_fade',
				style: 6,
				legacy: true,
				wear: [0, 0.08] as [number, number],
				composite: null
			}
		]
	]);
	assert.deepEqual(
		iconCosmetics(
			[
				'weapon_ak47_cu_ak-47_phantom_disruptor',
				'weapon_knife_karambit_aa_fade',
				'weapon_ak47_unknown',
				'leather_handwraps_x'
			],
			items,
			kits
		),
		[
			{ item: 7, paint: 941 },
			{ item: 507, paint: 38 }
		]
	);
	assert.deepEqual(
		trimParams({
			shader: '',
			ints: { F_PAINT_STYLE: 1, g_bEnableSticker0: 0 },
			floats: { g_flPatternTexCoordScale: 2, g_fGlitterScale: 25 },
			vectors: { g_vColor0: [1, 1, 1, 1], g_vSticker0Offset: [0, 0, 0, 0] },
			textures: {},
			strings: {}
		}),
		{
			ints: { F_PAINT_STYLE: 1 },
			floats: { g_flPatternTexCoordScale: 2 },
			vectors: { g_vColor0: [1, 1, 1, 1] }
		}
	);
});
