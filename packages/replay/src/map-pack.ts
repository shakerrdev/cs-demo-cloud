import type { Vec3 } from './mesh.ts';

export type Vec4 = [number, number, number, number];

export const MAP_PACK_VERSION = 1;
export const MAP_PACK_MANIFEST = 'map.json';

const TEXTURE_MAGIC = 0x58545343;
const TEXTURE_VERSION = 1;
const TEXTURE_HEADER_SIZE = 20;

export const TEXTURE_FORMATS = [
	'bc1',
	'bc3',
	'bc4',
	'bc5',
	'bc6h',
	'bc7',
	'rgba8',
	'rgba16f',
	'r8'
] as const;
export type TextureFormat = (typeof TEXTURE_FORMATS)[number];

export const TEXTURE_CLAMP_S = 1;
export const TEXTURE_CLAMP_T = 2;
export const TEXTURE_VOLUME = 4;

export interface PackTexture {
	width: number;
	height: number;
	depth: number;
	faces: 1 | 6;
	mips: number;
	format: TextureFormat;
	flags: number;
	mipData: Uint8Array[];
}

export interface PackTextureRef {
	file: string;
	format: TextureFormat;
	width: number;
	height: number;
	depth: number;
	faces: 1 | 6;
	bytes: number;
	low?: { file: string; width: number; height: number; bytes: number };
}

export interface PackLightmaps {
	version: number;
	irradiance: string;
	directional: string | null;
	directionalSh: [string, string, string] | null;
	shadows: string | null;
}

export interface PackSun {
	toSun: Vec3;
	color: Vec3;
	shadowChannel: number;
	specular: boolean;
}

export interface PackProbeVolume {
	origin: Vec3;
	angles: Vec3;
	min: Vec3;
	max: Vec3;
	edgeFade: Vec3;
	atlasOffset: Vec3;
	atlasSize: Vec3;
}

export interface PackProbes {
	irradiance: string;
	shadows: string | null;
	volumes: PackProbeVolume[];
}

export interface PackEnvMapVolume {
	origin: Vec3;
	angles: Vec3;
	min: Vec3;
	max: Vec3;
	edgeFade: Vec3;
	arrayIndex: number;
	box: boolean;
	normalization: Vec4;
}

export interface PackEnvMaps {
	texture: string;
	volumes: PackEnvMapVolume[];
}

export interface PackWorld {
	id: string;
	kind: 'world' | 'skybox';
	model: string;
	lightmaps: PackLightmaps | null;
	probes: PackProbes | null;
	envMaps?: PackEnvMaps | null;
	sun: PackSun | null;
	skyCamera: { origin: Vec3; scale: number } | null;
}

export interface PackSky {
	texture: string;
	exposureBias: number;
	tint: Vec3;
	angles: Vec3;
	radianceSh: number[] | null;
}

export interface PackCubemapFog {
	start: number;
	end: number;
	falloffExponent: number;
	useHeight: boolean;
	heightStart: number;
	heightEnd: number;
	heightExponent: number;
	lodBias: number;
	maxOpacity: number;
	exposureBias: number;
	texture: string;
	angles: Vec3;
}

export interface PackGradientFog {
	start: number;
	end: number;
	falloffExponent: number;
	heightStart: number;
	heightEnd: number;
	heightExponent: number;
	color: Vec3;
	strength: number;
	maxOpacity: number;
}

export interface PackFog {
	cubemap: PackCubemapFog | null;
	gradient: PackGradientFog | null;
}

export interface PackTonemap {
	exposureBias: number;
	shoulderStrength: number;
	linearStrength: number;
	linearAngle: number;
	toeStrength: number;
	toeNum: number;
	toeDenom: number;
	whitePoint: number;
}

export type BloomBlendMode = 'add' | 'screen' | 'blur';

export interface PackBloom {
	strength: number;
	screenStrength: number;
	blurStrength: number;
	threshold: number;
	thresholdWidth: number;
	skyboxStrength: number;
	blendMode?: BloomBlendMode;
	blurWeights?: number[];
	blurTints?: Vec3[];
}

export interface PackPostProcess {
	tonemap: PackTonemap | null;
	bloom: PackBloom | null;
	lut: string | null;
}

export interface MapPackManifest {
	version: number;
	map: string;
	exportedAt: string;
	build: string | null;
	tools: Record<string, string>;
	worlds: PackWorld[];
	textures: Record<string, PackTextureRef>;
	sky: PackSky | null;
	ambient: { skyColor: Vec3; skyIntensity: number } | null;
	exposure: { min: number; max: number } | null;
	postProcess: PackPostProcess | null;
	fog: PackFog | null;
}

const BLOCK_BYTES: Partial<Record<TextureFormat, number>> = {
	bc1: 8,
	bc3: 16,
	bc4: 8,
	bc5: 16,
	bc6h: 16,
	bc7: 16
};

const PIXEL_BYTES: Partial<Record<TextureFormat, number>> = { rgba8: 4, rgba16f: 8, r8: 1 };

export function isBlockCompressed(format: TextureFormat): boolean {
	return format in BLOCK_BYTES;
}

export function mipSize(size: number, level: number): number {
	return Math.max(1, size >> level);
}

export function mipSlices(texture: Pick<PackTexture, 'depth' | 'faces' | 'flags'>, level: number) {
	const depth = texture.flags & TEXTURE_VOLUME ? mipSize(texture.depth, level) : texture.depth;
	return depth * texture.faces;
}

export function mipBytes(
	format: TextureFormat,
	width: number,
	height: number,
	slices: number
): number {
	const block = BLOCK_BYTES[format];
	if (block) return Math.ceil(width / 4) * Math.ceil(height / 4) * block * slices;
	return width * height * PIXEL_BYTES[format]! * slices;
}

export function encodePackTexture(texture: PackTexture): Uint8Array {
	const { width, height, depth, faces, mips, format, flags, mipData } = texture;
	if (mipData.length !== mips) throw new Error(`Expected ${mips} mips, got ${mipData.length}`);
	const formatIndex = TEXTURE_FORMATS.indexOf(format);
	if (formatIndex < 0) throw new Error(`Unknown texture format ${format}`);

	const tableSize = mips * 4;
	const total = mipData.reduce((sum, mip) => sum + mip.length, TEXTURE_HEADER_SIZE + tableSize);
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	view.setUint32(0, TEXTURE_MAGIC, true);
	view.setUint16(4, TEXTURE_VERSION, true);
	view.setUint16(6, formatIndex, true);
	view.setUint16(8, width, true);
	view.setUint16(10, height, true);
	view.setUint16(12, depth, true);
	view.setUint8(14, faces);
	view.setUint8(15, mips);
	view.setUint16(16, flags, true);

	let offset = TEXTURE_HEADER_SIZE + tableSize;
	mipData.forEach((mip, level) => {
		const expected = mipBytes(
			format,
			mipSize(width, level),
			mipSize(height, level),
			mipSlices(texture, level)
		);
		if (mip.length !== expected)
			throw new Error(`Mip ${level} is ${mip.length} bytes, expected ${expected}`);
		view.setUint32(TEXTURE_HEADER_SIZE + level * 4, mip.length, true);
		out.set(mip, offset);
		offset += mip.length;
	});
	return out;
}

export function decodePackTexture(input: ArrayBuffer | Uint8Array): PackTexture {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < TEXTURE_HEADER_SIZE || view.getUint32(0, true) !== TEXTURE_MAGIC)
		throw new Error('Not a map texture');
	if (view.getUint16(4, true) !== TEXTURE_VERSION) throw new Error('Unsupported texture version');

	const format = TEXTURE_FORMATS[view.getUint16(6, true)];
	if (!format) throw new Error('Unknown texture format');
	const faces = view.getUint8(14);
	if (faces !== 1 && faces !== 6) throw new Error('Bad face count');
	const mips = view.getUint8(15);

	const mipData: Uint8Array[] = [];
	let offset = TEXTURE_HEADER_SIZE + mips * 4;
	for (let level = 0; level < mips; level++) {
		const length = view.getUint32(TEXTURE_HEADER_SIZE + level * 4, true);
		if (offset + length > bytes.byteLength) throw new Error('Texture is truncated');
		mipData.push(bytes.subarray(offset, offset + length));
		offset += length;
	}

	return {
		width: view.getUint16(8, true),
		height: view.getUint16(10, true),
		depth: view.getUint16(12, true),
		faces,
		mips,
		format,
		flags: view.getUint16(16, true),
		mipData
	};
}
