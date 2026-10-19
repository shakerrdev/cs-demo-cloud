import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

export interface ZipStreamEntry {
	name: string;
	path: string;
	size: number;
	modified: Date;
}

const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const CENTRAL = 0x02014b50;
const END64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
const END = 0x06054b50;
const VERSION = 45;
const FLAGS = 0x0808;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

const localSize = (name: Buffer) => 30 + name.length + 20;
const descriptorSize = 24;
const centralSize = (name: Buffer) => 46 + name.length + 28;
const endSize = 56 + 20 + 22;

export function uniqueZipNames(names: string[]): string[] {
	const used = new Set<string>();
	return names.map((name) => {
		let candidate = name;
		const dot = name.search(/\.dem(\.\w+)?$/i);
		const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
		for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${stem} (${i})${ext}`;
		used.add(candidate.toLowerCase());
		return candidate;
	});
}

export function zipStreamSize(entries: ZipStreamEntry[]): number {
	let size = endSize;
	for (const entry of entries) {
		const name = Buffer.from(entry.name);
		size += localSize(name) + entry.size + descriptorSize + centralSize(name);
	}
	return size;
}

function dosTime(date: Date): { time: number; date: number } {
	const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
	};
}

function localHeader(name: Buffer, modified: Date): Buffer {
	const out = Buffer.alloc(localSize(name));
	const { time, date } = dosTime(modified);
	out.writeUInt32LE(LOCAL, 0);
	out.writeUInt16LE(VERSION, 4);
	out.writeUInt16LE(FLAGS, 6);
	out.writeUInt16LE(0, 8);
	out.writeUInt16LE(time, 10);
	out.writeUInt16LE(date, 12);
	out.writeUInt32LE(0, 14);
	out.writeUInt32LE(MAX32, 18);
	out.writeUInt32LE(MAX32, 22);
	out.writeUInt16LE(name.length, 26);
	out.writeUInt16LE(20, 28);
	name.copy(out, 30);
	const extra = 30 + name.length;
	out.writeUInt16LE(1, extra);
	out.writeUInt16LE(16, extra + 2);
	return out;
}

function descriptor(crc: number, size: number): Buffer {
	const out = Buffer.alloc(descriptorSize);
	out.writeUInt32LE(DESCRIPTOR, 0);
	out.writeUInt32LE(crc, 4);
	out.writeBigUInt64LE(BigInt(size), 8);
	out.writeBigUInt64LE(BigInt(size), 16);
	return out;
}

function centralHeader(
	name: Buffer,
	modified: Date,
	crc: number,
	size: number,
	offset: number
): Buffer {
	const out = Buffer.alloc(centralSize(name));
	const { time, date } = dosTime(modified);
	out.writeUInt32LE(CENTRAL, 0);
	out.writeUInt16LE(VERSION, 4);
	out.writeUInt16LE(VERSION, 6);
	out.writeUInt16LE(FLAGS, 8);
	out.writeUInt16LE(0, 10);
	out.writeUInt16LE(time, 12);
	out.writeUInt16LE(date, 14);
	out.writeUInt32LE(crc, 16);
	out.writeUInt32LE(MAX32, 20);
	out.writeUInt32LE(MAX32, 24);
	out.writeUInt16LE(name.length, 28);
	out.writeUInt16LE(28, 30);
	out.writeUInt32LE(MAX32, 42);
	name.copy(out, 46);
	const extra = 46 + name.length;
	out.writeUInt16LE(1, extra);
	out.writeUInt16LE(24, extra + 2);
	out.writeBigUInt64LE(BigInt(size), extra + 4);
	out.writeBigUInt64LE(BigInt(size), extra + 12);
	out.writeBigUInt64LE(BigInt(offset), extra + 20);
	return out;
}

function end(count: number, directorySize: number, directoryOffset: number): Buffer {
	const out = Buffer.alloc(endSize);
	out.writeUInt32LE(END64, 0);
	out.writeBigUInt64LE(44n, 4);
	out.writeUInt16LE(VERSION, 12);
	out.writeUInt16LE(VERSION, 14);
	out.writeBigUInt64LE(BigInt(count), 24);
	out.writeBigUInt64LE(BigInt(count), 32);
	out.writeBigUInt64LE(BigInt(directorySize), 40);
	out.writeBigUInt64LE(BigInt(directoryOffset), 48);
	out.writeUInt32LE(LOCATOR64, 56);
	out.writeBigUInt64LE(BigInt(directoryOffset + directorySize), 64);
	out.writeUInt32LE(1, 72);
	out.writeUInt32LE(END, 76);
	out.writeUInt16LE(Math.min(count, MAX16), 84);
	out.writeUInt16LE(Math.min(count, MAX16), 86);
	out.writeUInt32LE(Math.min(directorySize, MAX32), 88);
	out.writeUInt32LE(Math.min(directoryOffset, MAX32), 92);
	return out;
}

async function* zipChunks(entries: ZipStreamEntry[]): AsyncGenerator<Buffer> {
	const central: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name);
		const header = localHeader(name, entry.modified);
		yield header;
		let crc = 0;
		let size = 0;
		for await (const chunk of createReadStream(entry.path)) {
			crc = crc32(chunk as Buffer, crc);
			size += (chunk as Buffer).length;
			yield chunk as Buffer;
		}
		if (size !== entry.size)
			throw new Error(`${entry.name} changed size while it was being exported`);
		yield descriptor(crc, size);
		central.push(centralHeader(name, entry.modified, crc, size, offset));
		offset += header.length + size + descriptorSize;
	}
	const directorySize = central.reduce((sum, header) => sum + header.length, 0);
	yield* central;
	yield end(entries.length, directorySize, offset);
}

export function zipStream(entries: ZipStreamEntry[]): Readable {
	return Readable.from(zipChunks(entries), { objectMode: false });
}
