import {
	TEXTURE_CLAMP_S,
	TEXTURE_CLAMP_T,
	TEXTURE_VOLUME,
	mipBytes,
	mipSize,
	type PackTexture,
	type TextureFormat
} from '@cs-demo-cloud/replay';
import { decodeLz4Block } from './lz4.ts';

const FLAG_CLAMP_S = 1 << 0;
const FLAG_CLAMP_T = 1 << 1;
const FLAG_CUBE = 1 << 4;
const FLAG_VOLUME = 1 << 5;

const EXTRA_COMPRESSED_MIP_SIZE = 4;
const EXTRA_CUBEMAP_RADIANCE_SH = 5;

interface SourceFormat {
	name: string;
	bytes: number;
	block: boolean;
	to: TextureFormat | null;
}

const SOURCE_FORMATS: Record<number, SourceFormat> = {
	1: { name: 'DXT1', bytes: 8, block: true, to: 'bc1' },
	2: { name: 'DXT5', bytes: 16, block: true, to: 'bc3' },
	3: { name: 'I8', bytes: 1, block: false, to: 'r8' },
	4: { name: 'RGBA8888', bytes: 4, block: false, to: 'rgba8' },
	5: { name: 'R16', bytes: 2, block: false, to: null },
	6: { name: 'RG1616', bytes: 4, block: false, to: null },
	7: { name: 'RGBA16161616', bytes: 8, block: false, to: null },
	8: { name: 'R16F', bytes: 2, block: false, to: 'rgba16f' },
	9: { name: 'RG1616F', bytes: 4, block: false, to: 'rgba16f' },
	10: { name: 'RGBA16161616F', bytes: 8, block: false, to: 'rgba16f' },
	11: { name: 'R32F', bytes: 4, block: false, to: null },
	12: { name: 'RG3232F', bytes: 8, block: false, to: null },
	14: { name: 'RGBA32323232F', bytes: 16, block: false, to: null },
	19: { name: 'BC6H', bytes: 16, block: true, to: 'bc6h' },
	20: { name: 'BC7', bytes: 16, block: true, to: 'bc7' },
	21: { name: 'ATI2N', bytes: 16, block: true, to: 'bc5' },
	22: { name: 'IA88', bytes: 2, block: false, to: 'rgba8' },
	27: { name: 'ATI1N', bytes: 8, block: true, to: 'bc4' },
	28: { name: 'BGRA8888', bytes: 4, block: false, to: 'rgba8' },
	33: { name: 'R8_UNORM', bytes: 1, block: false, to: 'r8' }
};

export interface VtexInfo {
	width: number;
	height: number;
	depth: number;
	format: number;
	formatName: string;
	mips: number;
	flags: number;
	radianceSh: number[] | null;
}

export interface ParsedVtex {
	info: VtexInfo;
	texture: PackTexture | null;
	unsupported: string | null;
}

function findBlock(
	bytes: Uint8Array,
	view: DataView,
	type: string
): { offset: number; size: number } {
	const blockOffset = view.getUint32(8, true);
	const blockCount = view.getUint32(12, true);
	let position = 8 + blockOffset;
	const decoder = new TextDecoder();
	for (let i = 0; i < blockCount; i++, position += 12) {
		const name = decoder.decode(bytes.subarray(position, position + 4));
		if (name === type) {
			return {
				offset: position + 4 + view.getUint32(position + 4, true),
				size: view.getUint32(position + 8, true)
			};
		}
	}
	throw new Error(`Resource has no ${type} block`);
}

function sourceMipBytes(format: SourceFormat, width: number, height: number, slices: number) {
	if (!format.block) return width * height * format.bytes * slices;
	return Math.ceil(width / 4) * Math.ceil(height / 4) * format.bytes * slices;
}

function halfFromFloat(value: number): number {
	const floatView = new Float32Array([value]);
	const x = new Uint32Array(floatView.buffer)[0]!;
	const sign = (x >>> 16) & 0x8000;
	const exponent = ((x >>> 23) & 0xff) - 127 + 15;
	const mantissa = x & 0x7fffff;
	if (exponent <= 0) return sign;
	if (exponent >= 31) return sign | 0x7c00;
	return sign | (exponent << 10) | (mantissa >>> 13);
}

const HALF_ONE = halfFromFloat(1);

function convert(source: SourceFormat, data: Uint8Array): Uint8Array {
	switch (source.name) {
		case 'BGRA8888': {
			const out = new Uint8Array(data.length);
			for (let i = 0; i < data.length; i += 4) {
				out[i] = data[i + 2]!;
				out[i + 1] = data[i + 1]!;
				out[i + 2] = data[i]!;
				out[i + 3] = data[i + 3]!;
			}
			return out;
		}
		case 'IA88': {
			const out = new Uint8Array(data.length * 2);
			for (let i = 0, o = 0; i < data.length; i += 2, o += 4) {
				out[o] = out[o + 1] = out[o + 2] = data[i]!;
				out[o + 3] = data[i + 1]!;
			}
			return out;
		}
		case 'R16F':
		case 'RG1616F': {
			const channels = source.name === 'R16F' ? 1 : 2;
			const input = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
			const pixels = input.length / channels;
			const out = new Uint16Array(pixels * 4);
			for (let p = 0; p < pixels; p++) {
				out[p * 4] = input[p * channels]!;
				out[p * 4 + 1] = channels > 1 ? input[p * channels + 1]! : 0;
				out[p * 4 + 2] = 0;
				out[p * 4 + 3] = HALF_ONE;
			}
			return new Uint8Array(out.buffer);
		}
		default:
			return data;
	}
}

export function parseVtex(bytes: Uint8Array): ParsedVtex {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(4, true) !== 12) throw new Error('Unsupported resource header');
	const data = findBlock(bytes, view, 'DATA');
	let p = data.offset;

	if (view.getUint16(p, true) !== 1) throw new Error('Unsupported VTEX version');
	const flags = view.getUint16(p + 2, true);
	const width = view.getUint16(p + 20, true);
	const height = view.getUint16(p + 22, true);
	const depth = view.getUint16(p + 24, true);
	const format = view.getUint8(p + 26);
	const mips = view.getUint8(p + 27);
	const extraOffset = p + 32 + view.getUint32(p + 32, true);
	const extraCount = view.getUint32(p + 36, true);

	let compressedMips: number[] | null = null;
	let compression = 0;
	let radianceSh: number[] | null = null;

	for (let i = 0; i < extraCount; i++) {
		const entry = extraOffset + i * 12;
		const type = view.getUint32(entry, true);
		const start = entry + 4 + view.getUint32(entry + 4, true);
		if (type === EXTRA_COMPRESSED_MIP_SIZE) {
			compression = view.getUint32(start, true);
			const listStart = start + 4 + view.getUint32(start + 4, true);
			const count = view.getUint32(start + 8, true);
			compressedMips = [];
			for (let m = 0; m < count; m++) compressedMips.push(view.getInt32(listStart + m * 4, true));
		} else if (type === EXTRA_CUBEMAP_RADIANCE_SH) {
			const listStart = start + view.getUint32(start, true);
			const count = view.getUint32(start + 4, true);
			radianceSh = [];
			for (let c = 0; c < count; c++) radianceSh.push(view.getFloat32(listStart + c * 4, true));
		}
	}

	const source = SOURCE_FORMATS[format];
	const info: VtexInfo = {
		width,
		height,
		depth,
		format,
		formatName: source?.name ?? `format ${format}`,
		mips,
		flags,
		radianceSh
	};
	if (!source?.to) return { info, texture: null, unsupported: info.formatName };
	if (compressedMips && compression === 2) return { info, texture: null, unsupported: 'zstd mips' };

	const volume = (flags & FLAG_VOLUME) !== 0;
	if (volume && source.block && depth > 1 && depth < 4)
		return { info, texture: null, unsupported: 'thin compressed volume' };
	const faces = flags & FLAG_CUBE ? 6 : 1;
	const mipData: Uint8Array[] = new Array(mips);
	let position = data.offset + data.size;

	for (let level = mips - 1; level >= 0; level--) {
		const slices = (volume ? mipSize(Math.max(1, depth), level) : Math.max(1, depth)) * faces;
		const size = sourceMipBytes(source, mipSize(width, level), mipSize(height, level), slices);
		const stored = compressedMips?.[level];
		let mip: Uint8Array;
		if (stored !== undefined && stored < size) {
			mip = new Uint8Array(size);
			const written = decodeLz4Block(bytes.subarray(position, position + stored), mip);
			if (written !== size) throw new Error(`Mip ${level} decoded to ${written} of ${size} bytes`);
			position += stored;
		} else {
			if (position + size > bytes.length) throw new Error('Texture data is truncated');
			mip = bytes.slice(position, position + size);
			position += size;
		}
		const converted = convert(source, mip);
		const expected = mipBytes(source.to, mipSize(width, level), mipSize(height, level), slices);
		if (converted.length !== expected)
			throw new Error(`Mip ${level} is ${converted.length} bytes, expected ${expected}`);
		mipData[level] = converted;
	}

	return {
		info,
		unsupported: null,
		texture: {
			width,
			height,
			depth: Math.max(1, depth),
			faces,
			mips,
			format: source.to,
			flags:
				(flags & FLAG_CLAMP_S ? TEXTURE_CLAMP_S : 0) |
				(flags & FLAG_CLAMP_T ? TEXTURE_CLAMP_T : 0) |
				(volume ? TEXTURE_VOLUME : 0),
			mipData
		}
	};
}
