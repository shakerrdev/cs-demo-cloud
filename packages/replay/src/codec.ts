import type { RoundColumns, RoundMeta, RoundReplay, ViewColumns } from './types.ts';

const MAGIC = 0x31525343;
const HEADER_SIZE = 8;

type IntArray = Int32Array | Int16Array | Uint16Array | Uint8Array;
type ColumnType =
	Int32ArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor;
type ColumnSpec<K extends string> = [K, ColumnType, boolean];

const COLUMNS: ColumnSpec<keyof RoundColumns>[] = [
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

const EXTRA_COLUMNS: ColumnSpec<keyof RoundColumns>[] = [
	['clip', Uint8Array, false],
	['reserve', Uint8Array, false],
	['zoom', Uint8Array, false]
];

const VIEW_COLUMNS: ColumnSpec<keyof ViewColumns>[] = [
	['x', Int32Array, true],
	['y', Int32Array, true],
	['z', Int32Array, true],
	['yaw', Uint16Array, true],
	['pitch', Int16Array, true],
	['punchPitch', Int16Array, true],
	['punchYaw', Int16Array, true],
	['duck', Uint8Array, false]
];

const align4 = (n: number) => (n + 3) & ~3;

export function createColumns(size: number, extra = true): RoundColumns {
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
		flags: new Uint8Array(size),
		...(extra
			? { clip: new Uint8Array(size), reserve: new Uint8Array(size), zoom: new Uint8Array(size) }
			: {})
	};
}

export function createViewColumns(size: number): ViewColumns {
	return {
		x: new Int32Array(size),
		y: new Int32Array(size),
		z: new Int32Array(size),
		yaw: new Uint16Array(size),
		pitch: new Int16Array(size),
		punchPitch: new Int16Array(size),
		punchYaw: new Int16Array(size),
		duck: new Uint8Array(size)
	};
}

function hasExtra(meta: RoundMeta): boolean {
	return meta.version >= 2;
}

function sections(replay: { meta: RoundMeta }) {
	const { meta } = replay;
	const size = meta.players.length * meta.frameCount;
	const list: { specs: ColumnSpec<string>[]; size: number; frames: number; view: boolean }[] = [
		{ specs: COLUMNS, size, frames: meta.frameCount, view: false }
	];
	if (hasExtra(meta))
		list.push({ specs: EXTRA_COLUMNS, size, frames: meta.frameCount, view: false });
	if (meta.view)
		list.push({
			specs: VIEW_COLUMNS,
			size: meta.players.length * meta.view.frameCount,
			frames: meta.view.frameCount,
			view: true
		});
	return list;
}

export function encodeRound(replay: RoundReplay): Uint8Array {
	const { meta } = replay;
	if (meta.view && !replay.view) throw new Error('Replay has a view grid but no view columns');
	const json = new TextEncoder().encode(JSON.stringify(meta));
	const parts = sections(replay);
	const dataStart = align4(HEADER_SIZE + json.length);
	let dataSize = 0;
	for (const part of parts)
		for (const [, Type] of part.specs) dataSize += part.size * Type.BYTES_PER_ELEMENT;

	const out = new Uint8Array(dataStart + dataSize);
	const view = new DataView(out.buffer);
	view.setUint32(0, MAGIC, true);
	view.setUint32(4, json.length, true);
	out.set(json, HEADER_SIZE);

	let offset = dataStart;
	for (const part of parts) {
		const source = (part.view ? replay.view : replay.columns) as unknown as Record<
			string,
			IntArray | undefined
		>;
		for (const [key, Type, delta] of part.specs) {
			const column = source[key];
			if (!column || column.length !== part.size) {
				throw new Error(`Column ${key} has ${column?.length ?? 0} values, expected ${part.size}`);
			}
			const target = new Type(part.size);
			if (delta) deltaEncode(column, target, part.frames);
			else target.set(column);
			out.set(new Uint8Array(target.buffer), offset);
			offset += target.byteLength;
		}
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

	const columns: Record<string, IntArray> = {};
	const viewColumns: Record<string, IntArray> = {};
	let offset = align4(HEADER_SIZE + jsonLength);

	for (const part of sections({ meta })) {
		const target = part.view ? viewColumns : columns;
		for (const [key, Type, delta] of part.specs) {
			const byteLength = part.size * Type.BYTES_PER_ELEMENT;
			const copy = new Uint8Array(byteLength);
			copy.set(bytes.subarray(offset, offset + byteLength));
			const column = new Type(copy.buffer);
			if (delta) deltaDecode(column, part.frames);
			target[key] = column;
			offset += byteLength;
		}
	}

	return {
		meta,
		columns: columns as unknown as RoundColumns,
		...(meta.view ? { view: viewColumns as unknown as ViewColumns } : {})
	};
}

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
