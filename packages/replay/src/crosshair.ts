const DICTIONARY = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';

export interface Crosshair {
	style: number;
	size: number;
	gap: number;
	thickness: number;
	outline: number;
	outlineEnabled: boolean;
	color: number;
	red: number;
	green: number;
	blue: number;
	alpha: number;
	alphaEnabled: boolean;
	dot: boolean;
	tStyle: boolean;
	followRecoil: boolean;
	splitDistance: number;
	fixedGap: number;
	innerSplitAlpha: number;
	outerSplitAlpha: number;
	splitSizeRatio: number;
	deployedWeaponGap: boolean;
}

const COLORS: [number, number, number][] = [
	[250, 50, 50],
	[50, 250, 50],
	[250, 250, 50],
	[50, 50, 250],
	[50, 250, 250]
];

export function shareCodeBytes(code: string): Uint8Array | null {
	const body = code.replace(/^CSGO/, '').replaceAll('-', '');
	if (body.length !== 25) return null;
	let value = 0n;
	for (const char of [...body].reverse()) {
		const index = DICTIONARY.indexOf(char);
		if (index < 0) return null;
		value = value * 57n + BigInt(index);
	}
	const bytes = new Uint8Array(18);
	for (let i = 17; i >= 0; i--) {
		bytes[i] = Number(value & 0xffn);
		value >>= 8n;
	}
	return bytes;
}

const signed = (byte: number) => (byte > 127 ? byte - 256 : byte);

export function decodeCrosshair(code: string): Crosshair | null {
	const bytes = shareCodeBytes(code);
	if (!bytes) return null;
	let sum = 0;
	for (let i = 1; i < bytes.length; i++) sum += bytes[i]!;
	if ((sum & 0xff) !== bytes[0]) return null;
	return {
		gap: signed(bytes[2]!) / 10,
		outline: bytes[3]! / 2,
		red: bytes[4]!,
		green: bytes[5]!,
		blue: bytes[6]!,
		alpha: bytes[7]!,
		splitDistance: bytes[8]! & 0x7f,
		followRecoil: (bytes[8]! & 0x80) !== 0,
		fixedGap: signed(bytes[9]!) / 10,
		color: bytes[10]! & 7,
		outlineEnabled: (bytes[10]! & 8) !== 0,
		innerSplitAlpha: (bytes[10]! >> 4) / 10,
		outerSplitAlpha: (bytes[11]! & 0xf) / 10,
		splitSizeRatio: (bytes[11]! >> 4) / 10,
		thickness: bytes[12]! / 10,
		dot: ((bytes[13]! >> 4) & 1) !== 0,
		deployedWeaponGap: ((bytes[13]! >> 4) & 2) !== 0,
		alphaEnabled: ((bytes[13]! >> 4) & 4) !== 0,
		tStyle: ((bytes[13]! >> 4) & 8) !== 0,
		style: (bytes[13]! & 0xf) >> 1,
		size: (((bytes[15]! & 0x1f) << 8) + bytes[14]!) / 10
	};
}

export function crosshairColor(crosshair: Crosshair): string {
	const [r, g, b] =
		crosshair.color === 5
			? [crosshair.red, crosshair.green, crosshair.blue]
			: (COLORS[crosshair.color] ?? COLORS[1]!);
	const alpha = crosshair.alphaEnabled ? crosshair.alpha / 255 : 1;
	return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
