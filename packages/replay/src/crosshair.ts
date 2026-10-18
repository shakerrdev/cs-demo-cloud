const DICTIONARY = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';

export type Rgba = [number, number, number, number];

export interface Crosshair {
	style: number;
	length: number;
	thickness: number;
	gap: number;
	dot: boolean;
	tStyle: boolean;
	color: Rgba;
	outline: { width: number; color: Rgba; half: boolean } | null;
	splitRatio: number;
	screenHeight: number;
}

const COLORS: [number, number, number][] = [
	[250, 50, 50],
	[50, 250, 50],
	[250, 250, 50],
	[50, 50, 250],
	[50, 250, 250]
];

export function shareCodeBytes(code: string): Uint8Array | null {
	const trimmed = code.trim();
	const legacy = trimmed.startsWith('CSGO');
	const body = trimmed.replace(/^CSGO|^CS/, '').replaceAll('-', '');
	const size = legacy ? 18 : 32;
	if (body.length !== (legacy ? 25 : 44)) return null;
	let value = 0n;
	for (const char of [...body].reverse()) {
		const index = DICTIONARY.indexOf(char);
		if (index < 0) return null;
		value = value * 57n + BigInt(index);
	}
	if (value >> BigInt(size * 8) !== 0n) return null;
	const bytes = new Uint8Array(size);
	for (let i = size - 1; i >= 0; i--) {
		bytes[i] = Number(value & 0xffn);
		value >>= 8n;
	}
	let sum = 0;
	for (let i = 1; i < size; i++) sum += bytes[i]!;
	return (sum & 0xff) === bytes[0] ? bytes : null;
}

const signed = (byte: number) => (byte > 127 ? byte - 256 : byte);

function legacyCrosshair(bytes: Uint8Array): Crosshair {
	const color = bytes[10]! & 7;
	const alphaEnabled = ((bytes[13]! >> 4) & 4) !== 0;
	const alpha = alphaEnabled ? bytes[7]! : 255;
	const rgb = color === 5 ? [bytes[4]!, bytes[5]!, bytes[6]!] : (COLORS[color] ?? COLORS[1]!);
	const outline = bytes[3]! / 2;
	return {
		style: (bytes[13]! & 0xf) >> 1,
		length: (((bytes[15]! & 0x1f) << 8) + bytes[14]!) / 10,
		thickness: bytes[12]! / 10,
		gap: (signed(bytes[2]!) / 10 + 4.5) * 0.5,
		dot: ((bytes[13]! >> 4) & 1) !== 0,
		tStyle: ((bytes[13]! >> 4) & 8) !== 0,
		color: [rgb[0]!, rgb[1]!, rgb[2]!, alpha],
		outline:
			(bytes[10]! & 8) !== 0 && outline > 0
				? { width: (outline * 480) / 1080, color: [0, 0, 0, alpha], half: false }
				: null,
		splitRatio: 1,
		screenHeight: 480
	};
}

function pixelCrosshair(bytes: Uint8Array): Crosshair | null {
	if (bytes[1] !== 1) return null;
	const screenHeight = bytes[2]! | (bytes[3]! << 8);
	if (!screenHeight) return null;
	const flags = bytes[4]!;
	const gap = bytes[14]! | (bytes[15]! << 8);
	const bits = (bytes[18]! | (bytes[19]! << 8) | (bytes[20]! << 16) | (bytes[21]! << 24)) >>> 0;
	const mode = bytes[13]! >> 6;
	return {
		style: Math.min(flags & 0x1f, 9),
		length: bytes[16]!,
		thickness: bytes[13]! & 0x3f,
		gap: gap >= 0x8000 ? gap - 0x10000 : gap,
		dot: ((flags >> 6) & 1) !== 0,
		tStyle: ((flags >> 7) & 1) !== 0,
		color: [bytes[5]!, bytes[6]!, bytes[7]!, bytes[8]!],
		outline:
			mode > 0
				? { width: 1, color: [bytes[9]!, bytes[10]!, bytes[11]!, bytes[12]!], half: mode === 2 }
				: null,
		splitRatio: Math.min((bits >>> 21) & 0x7f, 100) / 100,
		screenHeight
	};
}

export function decodeCrosshair(code: string): Crosshair | null {
	const bytes = shareCodeBytes(code);
	if (!bytes) return null;
	return bytes.length === 18 ? legacyCrosshair(bytes) : pixelCrosshair(bytes);
}

export function rgbaCss([r, g, b, a]: Rgba): string {
	return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function crosshairColor(crosshair: Crosshair): string {
	return rgbaCss(crosshair.color);
}
