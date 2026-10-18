import * as THREE from 'three';
import { fragmentShader, vertexShader } from './shader.ts';

export interface Vmat {
	Name: string;
	ShaderName: string;
	IntParams: Record<string, number>;
	FloatParams: Record<string, number>;
	VectorParams: Record<string, number[]>;
	TextureParams: Record<string, string>;
}

export interface VertexLayout {
	lightmap: number | null;
	uv2: number | null;
	paint: number | null;
	blend: number | null;
}

export interface MaterialExtras {
	vmat?: Vmat;
	tint?: number[];
	layout?: VertexLayout;
	paint?: PaintExtras;
	glove?: GloveExtras;
}

type Vec4 = [number, number, number, number];

export interface GloveExtras {
	textures: {
		mask?: string;
		surface?: string;
		normal?: string;
		pattern?: string;
		detail: (string | undefined)[];
		detailNormal: (string | undefined)[];
	};
	tints: number[][];
	palette: Vec4;
	patternX0: Vec4;
	patternX1: Vec4;
	detailScale: Vec4;
	blackPoint: Vec4;
	roughContrast: Vec4;
	roughBrightness: Vec4;
	metalness: Vec4;
	normalContrast: Vec4;
	curvature: Vec4;
	params: Vec4;
	params2: Vec4;
	patternProps: Vec4;
}

export interface PaintExtras {
	style: number;
	textures: {
		pattern?: string;
		normal?: string;
		wear?: string;
		grunge?: string;
		masks?: string;
		ao?: string;
		position?: string;
		surface?: string;
	};
	colors: number[][];
	durability: number[];
	roughnessColors: number[];
	metalnessColors: number[];
	albedoLevels: number[];
	metallicAlbedoLevels: number[];
	sprayBias: [y: number, z: number];
	pattern: [scale: number, rotation: number, x: number, y: number];
	wearTransform: [scale: number, rotation: number, x: number, y: number];
	grunge: [scale: number, rotation: number, x: number, y: number];
	wear: number;
	softness: number;
	brightness: number;
	roughness: number;
	metalness: number;
	roughnessPerColor: boolean;
	colorAdjustment: number;
}

const round2 = (value: number) => Math.floor((value + 0.005) * 100) / 100;

export function paintTransform([scale, rotation, x, y]: number[]): THREE.Matrix3 {
	const s = round2(scale ?? 1);
	const angle = (round2(rotation ?? 0) * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const half = 0.5 / (s !== 0 ? s : 1);
	const a = half * Math.cos(-angle) - half * Math.sin(-angle);
	const b = a * Math.sin(-angle) + half * Math.cos(-angle);
	return new THREE.Matrix3().set(
		cos * s,
		-sin * s,
		s * cos * a - s * sin * b + round2(x ?? 0) - 0.5,
		sin * s,
		cos * s,
		s * sin * a + s * cos * b + round2(y ?? 0) - 0.5,
		0,
		0,
		1
	);
}

export type Uniforms = Record<string, THREE.IUniform>;

export interface WorldShading {
	uniforms: Uniforms;
	defines: Record<string, string | number>;
}

export interface TextureRequest {
	(path: string, srgb: boolean, target: THREE.IUniform): void;
}

export const defaultTextures = (() => {
	const make = (rgba: number[]) => {
		const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
		texture.needsUpdate = true;
		return texture;
	};
	return {
		white: make([255, 255, 255, 255]),
		black: make([0, 0, 0, 255]),
		grey: make([128, 128, 128, 255]),
		normal: make([128, 128, 255, 255])
	};
})();

const attributeName = (kind: 'uv' | 'color', index: number) =>
	kind === 'uv' ? `uv${index === 0 ? '' : index}` : index === 0 ? 'color' : `color_${index}`;

function uvTransform(vmat: Vmat, suffix = ''): THREE.Matrix3 {
	const scale = vmat.VectorParams[`g_vTexCoordScale${suffix}`] ?? [1, 1];
	const offset = vmat.VectorParams[`g_vTexCoordOffset${suffix}`] ?? [0, 0];
	const center = vmat.VectorParams[`g_vTexCoordCenter${suffix}`] ?? [0.5, 0.5];
	const rotation = ((vmat.FloatParams[`g_flTexCoordRotation${suffix}`] ?? 0) * Math.PI) / 180;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const [sx, sy] = [scale[0] ?? 1, scale[1] ?? 1];
	const [cx, cy] = [center[0] ?? 0.5, center[1] ?? 0.5];
	const m = new THREE.Matrix3();
	m.set(
		cos * sx,
		-sin * sy,
		-(cos * sx * cx - sin * sy * cy) + cx + (offset[0] ?? 0),
		sin * sx,
		cos * sy,
		-(sin * sx * cx + cos * sy * cy) + cy + (offset[1] ?? 0),
		0,
		0,
		1
	);
	return m;
}

function detailTransform(vmat: Vmat): THREE.Matrix3 {
	const scale = vmat.VectorParams.g_vDetailTexCoordScale ?? [1, 1];
	const offset = vmat.VectorParams.g_vDetailTexCoordOffset ?? [0, 0];
	const rotation = ((vmat.FloatParams.g_flDetailTexCoordRotation ?? 0) * Math.PI) / 180;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const [sx, sy] = [scale[0] ?? 1, scale[1] ?? 1];
	const m = new THREE.Matrix3();
	m.set(
		sx * cos,
		-sx * sin,
		sx * (-0.5 * cos + 0.5 * sin) + 0.5 + (offset[0] ?? 0),
		sy * sin,
		sy * cos,
		sy * (-0.5 * sin - 0.5 * cos) + 0.5 + (offset[1] ?? 0),
		0,
		0,
		1
	);
	return m;
}

const SRGB_PARAMS = /Color|Decal|Transmissive/;

function isSrgbParam(name: string): boolean {
	return SRGB_PARAMS.test(name) && !/Mask|Normal/.test(name);
}

export function createCs2Material(
	extras: MaterialExtras,
	world: WorldShading,
	request: TextureRequest
): THREE.ShaderMaterial {
	const vmat: Vmat = extras.vmat ?? {
		Name: 'default',
		ShaderName: 'default',
		IntParams: {},
		FloatParams: {},
		VectorParams: {},
		TextureParams: {}
	};
	const layout: VertexLayout = extras.layout ?? {
		lightmap: null,
		uv2: null,
		paint: null,
		blend: null
	};
	const shader = vmat.ShaderName.replace(/\.vfx$/, '');
	const I = vmat.IntParams;
	const F = vmat.FloatParams;
	const V = vmat.VectorParams;
	const T = vmat.TextureParams;
	const defines: Record<string, string | number> = { DETAIL: 0, FANCY_BLENDING: 0 };
	const uniforms: Uniforms = { ...world.uniforms };

	const tint = extras.tint ?? [1, 1, 1, 1];
	Object.assign(uniforms, {
		uTint: { value: new THREE.Vector3(tint[0] ?? 1, tint[1] ?? 1, tint[2] ?? 1) },
		uMetalness: { value: Math.min(1, Math.max(0, F.g_flMetalness ?? 0)) },
		uAlphaRef: { value: F.g_flAlphaTestReference ?? 0.5 },
		uOpacity: { value: F.g_flOpacityScale ?? 1 },
		uBumpStrength: { value: F.g_flBumpStrength ?? 1 },
		uBlendSoftness: { value: F.g_flBlendSoftness ?? 0.5 },
		uLayer2Scale: {
			value: new THREE.Vector2(V.g_vTexCoordScale2?.[0] ?? 1, V.g_vTexCoordScale2?.[1] ?? 1)
		},
		uUvTransform: { value: uvTransform(vmat) },
		uUvScroll: {
			value: new THREE.Vector2(
				V.g_vTexCoordScrollSpeed?.[0] ?? 0,
				V.g_vTexCoordScrollSpeed?.[1] ?? 0
			)
		},
		uDetailTransform: { value: detailTransform(vmat) },
		uDetailBlend: {
			value: new THREE.Vector3(
				F.g_flDetailBlendFactor ?? 1,
				F.g_flDetailBlendToFull ?? 0,
				F.g_flDetailNormalStrength ?? 1
			)
		},
		uSelfIllum: {
			value: new THREE.Vector4(
				F.g_flSelfIllumBrightness ?? 0,
				F.g_flSelfIllumScale ?? 1,
				F.g_flSelfIllumAlbedoFactor ?? 0,
				0
			)
		},
		uSelfIllumTint: {
			value: (() => {
				const color = new THREE.Color().setRGB(
					V.g_vSelfIllumTint?.[0] ?? 1,
					V.g_vSelfIllumTint?.[1] ?? 1,
					V.g_vSelfIllumTint?.[2] ?? 1,
					THREE.SRGBColorSpace
				);
				return new THREE.Vector3(color.r, color.g, color.b);
			})()
		},
		uMaskScales: {
			value: new THREE.Vector4(
				V.g_vMask1Scale?.[0] ?? 1,
				V.g_vMask1Scale?.[1] ?? 1,
				V.g_vMask2Scale?.[0] ?? 1,
				V.g_vMask2Scale?.[1] ?? 1
			)
		},
		uMaskScroll: {
			value: new THREE.Vector4(
				V.g_vMask1PanSpeed?.[0] ?? 0,
				V.g_vMask1PanSpeed?.[1] ?? 0,
				V.g_vMask2PanSpeed?.[0] ?? 0,
				V.g_vMask2PanSpeed?.[1] ?? 0
			)
		},
		uVertexAo: { value: F.g_flVertexAmbientOcclusionAmount ?? 0 },
		uMask3Scale: {
			value: new THREE.Vector4(
				V.g_vMask3Scale?.[0] ?? 1,
				V.g_vMask3Scale?.[1] ?? 1,
				V.g_vMask3PanSpeed?.[0] ?? 0,
				V.g_vMask3PanSpeed?.[1] ?? 0
			)
		},
		uEffect: {
			value: new THREE.Vector4(
				F.g_flColorBoost ?? 1,
				F.g_flFadeDistance ?? 1,
				F.g_flFadeMin ?? 0,
				F.g_flFadeMax ?? 1
			)
		},
		uEffectFresnel: {
			value: new THREE.Vector4(
				F.g_flFresnelExponent ?? 0.001,
				F.g_flFresnelFalloff ?? 1,
				F.g_flFresnelMin ?? 0,
				F.g_flFresnelMax ?? 1
			)
		},
		uEffectFade: { value: F.g_flFadeFalloff ?? 1 }
	});

	const bind = (uniform: string, param: string | undefined, fallback: THREE.Texture) => {
		uniforms[uniform] = { value: fallback };
		const path = param ? T[param] : undefined;
		if (path) request(path, isSrgbParam(param!), uniforms[uniform]!);
		return Boolean(path);
	};
	const first = (...names: string[]) => names.find((name) => T[name]);

	for (const sampler of [
		'uColor',
		'uAO',
		'uTintMask',
		'uColor2',
		'uDetail',
		'uDetailMask',
		'uSelfIllumMask',
		'uMask1',
		'uMask2',
		'uMask3',
		'uTransmissive'
	]) {
		uniforms[sampler] = { value: defaultTextures.white };
	}
	uniforms.uNormal = { value: defaultTextures.normal };
	uniforms.uNormal2 = { value: defaultTextures.normal };
	uniforms.uMetal = { value: defaultTextures.black };
	uniforms.uBlendMod = { value: defaultTextures.grey };

	bind(
		'uColor',
		first('g_tColor', 'g_tColor1', 'g_tColorA', 'g_tGlassDust'),
		defaultTextures.white
	);
	if (
		bind(
			'uNormal',
			first(
				'g_tNormal',
				'g_tLayer1NormalRoughness',
				'g_tNormalRoughness',
				'g_tNormal1',
				'g_tNormalA'
			),
			defaultTextures.normal
		)
	)
		defines.NORMAL_MAP = 1;

	const secondaryUv = layout.uv2 !== null ? 'vUv2' : 'vUv';
	const forceUv2 = I.F_FORCE_UV2 === 1;
	if (
		bind('uAO', first('g_tAmbientOcclusion', 'g_tLayer1AmbientOcclusion'), defaultTextures.white)
	) {
		defines.AO_TEXTURE = 1;
		defines.AO_UV = forceUv2 ? secondaryUv : 'vUv';
	}

	const alphaTest =
		I.F_ALPHA_TEST === 1 ||
		((shader === 'csgo_static_overlay' || shader === 'csgo_unlitgeneric') && I.F_BLEND_MODE === 2);
	const mod2x = shader === 'csgo_static_overlay' && I.F_BLEND_MODE === 3;
	const translucent =
		!mod2x &&
		(I.F_TRANSLUCENT === 1 ||
			shader === 'csgo_glass' ||
			shader === 'csgo_effects' ||
			((shader === 'csgo_static_overlay' || shader === 'csgo_unlitgeneric') &&
				(I.F_BLEND_MODE ?? 0) > 0 &&
				I.F_BLEND_MODE !== 2));
	if (alphaTest) defines.ALPHA_TEST = 1;
	if (translucent) defines.TRANSLUCENT = 1;
	if (mod2x) defines.MOD2X = 1;

	const unlit =
		shader === 'csgo_unlitgeneric' ||
		shader === 'csgo_black_unlit' ||
		shader === 'csgo_effects' ||
		shader === 'generic' ||
		shader === 'csgo_decalmodulate' ||
		(shader === 'csgo_static_overlay' && I.F_LIT !== 1) ||
		I.F_UNLIT === 1 ||
		I.F_FULLBRIGHT === 1;
	if (unlit) defines.UNLIT = 1;
	if (shader === 'csgo_black_unlit') uniforms.uTint = { value: new THREE.Vector3(0, 0, 0) };

	if (shader === 'csgo_effects') {
		defines.EFFECTS = 1;
		bind('uMask1', 'g_tMask1', defaultTextures.white);
		bind('uMask2', 'g_tMask2', defaultTextures.white);
		bind('uMask3', 'g_tMask3', defaultTextures.white);
	}

	if (layout.paint !== null) {
		if (shader === 'csgo_static_overlay' && I.F_PAINT_VERTEX_COLORS === 1)
			defines.PAINT_MULTIPLY = 1;
		if (shader === 'csgo_foliage' && (F.g_flVertexAmbientOcclusionAmount ?? 0) > 0)
			defines.VERTEX_AO = 1;
	}

	if (I.F_NOTINT === 1) defines.NO_TINT = 1;
	if (I.F_TINT_MASK === 1 && bind('uTintMask', 'g_tTintMask', defaultTextures.white)) {
		defines.TINT_MASK = 1;
		defines.TINT_UV = forceUv2 ? secondaryUv : 'vUv';
	}

	if (
		shader === 'csgo_vertexlitgeneric' ||
		shader === 'csgo_character' ||
		shader === 'csgo_weapon'
	) {
		if (bind('uMetal', 'g_tMetalness', defaultTextures.black)) defines.METAL_TEXTURE = 1;
	} else if (
		(shader === 'csgo_complex' || shader === 'csgo_simple') &&
		I.F_METALNESS_TEXTURE === 1
	) {
		defines.METAL_IN_ALPHA = 1;
	}

	if (
		(shader === 'csgo_lightmappedgeneric' || shader === 'csgo_environment_blend') &&
		(I.F_LAYERS ?? 0) > 0 &&
		layout.blend !== null
	) {
		defines.LAYERS = 1;
		bind('uColor2', first('g_tLayer2Color', 'g_tColor2', 'g_tColorB'), defaultTextures.white);
		bind(
			'uNormal2',
			first('g_tLayer2NormalRoughness', 'g_tNormalRoughness2', 'g_tNormal2', 'g_tNormalB'),
			defaultTextures.normal
		);
		const fancy = I.F_FANCY_BLENDING ?? 0;
		if (fancy > 0 && bind('uBlendMod', 'g_tBlendModulation', defaultTextures.grey))
			defines.FANCY_BLENDING = fancy;
	}

	const detailMode = I.F_DETAIL_TEXTURE ?? I.F_DETAILTEXTURE ?? 0;
	if (detailMode === 1 || detailMode === 2 || detailMode === 4) {
		if (bind('uDetail', first('g_tDetail', 'g_tLayer1Detail'), defaultTextures.grey)) {
			bind('uDetailMask', 'g_tDetailMask', defaultTextures.white);
			defines.DETAIL = detailMode;
			defines.DETAIL_UV =
				(I.g_bUseSecondaryUvForDetailTexture === 1 || forceUv2) && layout.uv2 !== null
					? 'vUv2'
					: 'vUv';
			defines.DETAIL_MASK_UV =
				(I.g_bUseSecondaryUvForDetailMask === 1 || forceUv2) && layout.uv2 !== null
					? 'vUv2'
					: 'vUv';
		}
	}

	if (I.F_SELF_ILLUM === 1 && bind('uSelfIllumMask', 'g_tSelfIllumMask', defaultTextures.white)) {
		defines.SELF_ILLUM = 1;
		defines.SELF_ILLUM_UV =
			I.g_bUseSecondaryUvForSelfIllum === 1 && layout.uv2 !== null ? 'vUv2' : 'vUv';
	}

	if (I.F_TRANSMISSIVE_BACKFACE_NDOTL === 1) {
		defines.TRANSMISSIVE = 1;
		if (I.F_USE_ALBEDO_FOR_TRANSMISSIVE === 1 || !T.g_tTransmissiveColor)
			defines.TRANSMISSIVE_COLOR = 'albedo';
		else {
			bind('uTransmissive', 'g_tTransmissiveColor', defaultTextures.white);
			defines.TRANSMISSIVE_COLOR = 'texture(uTransmissive, vUv).rgb';
		}
	}

	const ibl =
		shader === 'csgo_lightmappedgeneric' || shader === 'csgo_vertexlitgeneric'
			? I.F_SPECULAR_INDIRECT === 1
			: shader !== 'generic';
	if (ibl && world.defines.WORLD_ENV_MAP) defines.ENV_MAP = 1;
	else if (I.F_SPECULAR_INDIRECT === 1) defines.SPECULAR_INDIRECT = 1;

	if (layout.lightmap !== null && world.defines.WORLD_LIGHTMAP) {
		defines.LIGHTMAP = 1;
		defines.LIGHTMAP_ATTR = attributeName('uv', layout.lightmap);
	} else if (world.defines.WORLD_PROBES) {
		defines.PROBES = 1;
		if (world.defines.WORLD_PROBE_SHADOWS) defines.PROBE_SHADOWS = 1;
	}
	if (layout.uv2 !== null) defines.UV2_ATTR = attributeName('uv', layout.uv2);
	if (layout.paint !== null) defines.PAINT_ATTR = attributeName('color', layout.paint);
	if (layout.blend !== null) defines.BLEND_ATTR = attributeName('color', layout.blend);
	if (world.defines.FOG_CUBE && I.g_bFogEnabled !== 0) defines.FOG_CUBE = 1;
	if (world.defines.FOG_GRADIENT && I.g_bFogEnabled !== 0) defines.FOG_GRADIENT = 1;

	const paint = extras.paint;
	if (paint) {
		const style = paint.style >= 1 && paint.style <= 9 ? paint.style - 1 : 6;
		defines.SKIN_PAINT = style;
		const colorPattern = style >= 6;
		const texture = (
			uniform: string,
			path: string | undefined,
			srgb: boolean,
			fallback: THREE.Texture
		) => {
			uniforms[uniform] = { value: fallback };
			if (path) request(path, srgb, uniforms[uniform]!);
			return Boolean(path);
		};
		texture('uPattern', paint.textures.pattern, colorPattern, defaultTextures.white);
		texture('uPaintWear', paint.textures.wear, false, defaultTextures.white);
		texture('uPaintGrunge', paint.textures.grunge, true, defaultTextures.white);
		texture('uPaintMasks', paint.textures.masks, false, defaultTextures.black);
		texture('uPaintAo', paint.textures.ao, false, defaultTextures.white);
		texture('uPaintPosition', paint.textures.position, false, defaultTextures.black);
		texture('uPaintSurface', paint.textures.surface, false, defaultTextures.normal);
		if (texture('uPaintNormal', paint.textures.normal, false, defaultTextures.normal))
			defines.SKIN_PAINT_NORMAL = 1;
		uniforms.uPaintColors = {
			value: [0, 1, 2, 3].map((i) =>
				new THREE.Color().setRGB(
					...((paint.colors[i] ?? [1, 1, 1]).slice(0, 3) as [number, number, number]),
					THREE.SRGBColorSpace
				)
			)
		};
		const vec4 = (v: number[]) => new THREE.Vector4(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
		const vec3 = (v: number[]) => new THREE.Vector3(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
		uniforms.uPatternTransform = { value: paintTransform(paint.pattern) };
		uniforms.uWearTransform = { value: paintTransform(paint.wearTransform) };
		uniforms.uGrungeTransform = { value: paintTransform(paint.grunge) };
		uniforms.uPaintDurability = { value: vec4(paint.durability) };
		uniforms.uPaintRoughnessColors = { value: vec4(paint.roughnessColors) };
		uniforms.uPaintMetalnessColors = { value: vec4(paint.metalnessColors) };
		uniforms.uPaintAlbedoLevels = { value: vec3(paint.albedoLevels) };
		uniforms.uMetallicPaintAlbedoLevels = { value: vec3(paint.metallicAlbedoLevels) };
		uniforms.uPaintParams = {
			value: new THREE.Vector4(paint.wear, paint.softness, paint.brightness, paint.roughness)
		};
		uniforms.uPaintParams2 = {
			value: new THREE.Vector4(
				paint.metalness,
				paint.roughnessPerColor ? 1 : 0,
				paint.colorAdjustment,
				0
			)
		};
		uniforms.uSprayBias = { value: new THREE.Vector2(...paint.sprayBias) };
	}

	const glove = extras.glove;
	if (glove) {
		defines.GLOVE_PAINT = 1;
		const texture = (uniform: string, path: string | undefined, fallback: THREE.Texture) => {
			uniforms[uniform] = { value: fallback };
			if (path) request(path, false, uniforms[uniform]!);
		};
		texture('uGloveMask', glove.textures.mask, defaultTextures.black);
		texture('uGloveSurface', glove.textures.surface, defaultTextures.white);
		texture('uGloveNormal', glove.textures.normal, defaultTextures.normal);
		texture('uGlovePattern', glove.textures.pattern, defaultTextures.black);
		for (let i = 0; i < 4; i++) {
			texture(`uGloveDetail${i + 1}`, glove.textures.detail[i], defaultTextures.grey);
			texture(`uGloveDetailNormal${i + 1}`, glove.textures.detailNormal[i], defaultTextures.normal);
		}
		const v4 = (v: Vec4) => ({ value: new THREE.Vector4(...v) });
		uniforms.uGloveTints = {
			value: Array.from({ length: 8 }, (_, i) => {
				const [r = 1, g = 1, b = 1] = glove.tints[i] ?? [];
				return new THREE.Vector3(r, g, b);
			})
		};
		uniforms.uGlovePalette = v4(glove.palette);
		uniforms.uGlovePatternX0 = v4(glove.patternX0);
		uniforms.uGlovePatternX1 = v4(glove.patternX1);
		uniforms.uGloveDetailScale = v4(glove.detailScale);
		uniforms.uGloveBlackPoint = v4(glove.blackPoint);
		uniforms.uGloveRoughContrast = v4(glove.roughContrast);
		uniforms.uGloveRoughBrightness = v4(glove.roughBrightness);
		uniforms.uGloveMetalness = v4(glove.metalness);
		uniforms.uGloveNormalContrast = v4(glove.normalContrast);
		uniforms.uGloveCurvature = v4(glove.curvature);
		uniforms.uGloveParams = v4(glove.params);
		uniforms.uGloveParams2 = v4(glove.params2);
		uniforms.uGlovePatternProps = v4(glove.patternProps);
	}

	defines.ROUGHNESS =
		shader === 'csgo_weapon' && defines.METAL_TEXTURE
			? 'texture(uMetal, vUv).r'
			: shader === 'csgo_character' || shader === 'csgo_weapon'
				? 'normalTex.a'
				: 'normalTex.b';
	const material = new THREE.ShaderMaterial({
		name: vmat.Name,
		glslVersion: THREE.GLSL3,
		vertexShader,
		fragmentShader,
		uniforms,
		defines,
		side:
			I.F_RENDER_BACKFACES === 1 || shader === 'csgo_foliage' ? THREE.DoubleSide : THREE.FrontSide,
		transparent: translucent || mod2x,
		depthWrite: !(translucent || mod2x),
		alphaToCoverage: alphaTest
	});

	if (mod2x) {
		material.blending = THREE.CustomBlending;
		material.blendSrc = THREE.DstColorFactor;
		material.blendDst = THREE.SrcColorFactor;
		material.blendEquation = THREE.AddEquation;
	} else if (shader === 'csgo_effects' && I.F_ADDITIVE_BLEND === 1) {
		material.blending = THREE.AdditiveBlending;
	} else if (translucent) {
		material.blending = THREE.NormalBlending;
	}

	const decal =
		mod2x ||
		shader === 'csgo_static_overlay' ||
		I.F_OVERLAY === 1 ||
		I.F_DEPTH_BIAS === 1 ||
		shader === 'csgo_decalmodulate';
	if (decal) {
		material.polygonOffset = true;
		material.polygonOffsetFactor = -1;
		material.polygonOffsetUnits = -4;
	}
	return material;
}
