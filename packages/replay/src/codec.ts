import type { RoundColumns, RoundMeta, RoundReplay } from './types.ts';

const MAGIC = 0x31525343;
const HEADER_SIZE = 8;

type ColumnKey = keyof RoundColumns;
type ColumnType = Int16ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor;

const COLUMNS: [ColumnKey, ColumnType, boolean][] = [
	['x', Int16Array, true],
	['y', Int16Array, true],
	['z', Int16Array, true],
	['yaw', Uint16Array, true],
	['pitch', Int16Array, true],
	['money', Uint16Array, false],
	['health', Uint8Array, false],
	['armor', Uint8Array, false],
	['weapon', Uint8Array, false],
	['flags', Uint8Array, false]
];

const align4 = (n: number) => (n + 3) & ~3;

export function createColumns(size: number): RoundColumns {
	return {
		x: new Int16Array(size),
		y: new Int16Array(size),
		z: new Int16Array(size),
		yaw: new Uint16Array(size),
		pitch: new Int16Array(size),
		money: new Uint16Array(size),
		health: new Uint8Array(size),
		armor: new Uint8Array(size),
		weapon: new Uint8Array(size),
		flags: new Uint8Array(size)
	};
}

export function encodeRound({ meta, columns }: RoundReplay): Uint8Array {
	const json = new TextEncoder().encode(JSON.stringify(meta));
	const size = meta.players.length * meta.frameCount;
	const dataStart = align4(HEADER_SIZE + json.length);
	const dataSize = COLUMNS.reduce((total, [, Type]) => total + size * Type.BYTES_PER_ELEMENT, 0);

	const out = new Uint8Array(dataStart + dataSize);
	const view = new DataView(out.buffer);
	view.setUint32(0, MAGIC, true);
	view.setUint32(4, json.length, true);
	out.set(json, HEADER_SIZE);

	let offset = dataStart;
	for (const [key, Type, delta] of COLUMNS) {
		const source = columns[key];
		if (source.length !== size) {
			throw new Error(`Column ${key} has ${source.length} values, expected ${size}`);
		}
		const target = new Type(out.buffer, offset, size);
		if (delta) deltaEncode(source, target, meta.frameCount);
		else target.set(source);
		offset += target.byteLength;
	}

	return out;
}

export function decodeRound(input: ArrayBuffer | Uint8Array): RoundReplay {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a replay file');

	const jsonLength = view.getUint32(4, true);
	const meta = JSON.parse(
		new TextDecoder().decode(bytes.subarray(HEADER_SIZE, HEADER_SIZE + jsonLength))
	) as RoundMeta;

	const size = meta.players.length * meta.frameCount;
	const columns = {} as Record<ColumnKey, RoundColumns[ColumnKey]>;
	let offset = align4(HEADER_SIZE + jsonLength);

	for (const [key, Type, delta] of COLUMNS) {
		const byteLength = size * Type.BYTES_PER_ELEMENT;
		const copy = new Uint8Array(byteLength);
		copy.set(bytes.subarray(offset, offset + byteLength));
		const column = new Type(copy.buffer);
		if (delta) deltaDecode(column, meta.frameCount);
		columns[key] = column;
		offset += byteLength;
	}

	return { meta, columns: columns as RoundColumns };
}

type IntArray = Int16Array | Uint16Array | Uint8Array;

function deltaEncode(source: IntArray, target: IntArray, frames: number) {
	for (let start = 0; start < source.length; start += frames) {
		let previous = 0;
		for (let i = start; i < start + frames; i++) {
			const value = source[i]!;
			target[i] = value - previous;
			previous = value;
		}
	}
}

function deltaDecode(column: IntArray, frames: number) {
	for (let start = 0; start < column.length; start += frames) {
		let sum = 0;
		for (let i = start; i < start + frames; i++) {
			sum += column[i]!;
			column[i] = sum;
		}
	}
}
