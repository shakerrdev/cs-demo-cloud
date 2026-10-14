import { createWriteStream, type WriteStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
	name: string;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	localOffset: number;
}

export interface ZipReader {
	entries: Map<string, ZipEntry>;
	read(entry: ZipEntry): Promise<Uint8Array>;
	close(): Promise<void>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_ZIP32 = 0xffffffff;
const UTF8_FLAG = 0x800;

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function parseZipDirectory(
	tail: Uint8Array,
	tailStart: number
): { count: number; offset: number; size: number } {
	const tailView = view(tail);
	for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
		if (tailView.getUint32(i, true) !== EOCD_SIGNATURE) continue;
		const count = tailView.getUint16(i + 10, true);
		const size = tailView.getUint32(i + 12, true);
		const offset = tailView.getUint32(i + 16, true);
		if (count === 0xffff || offset === MAX_ZIP32) throw new Error('Zip64 is not supported');
		if (offset + size > tailStart + i) throw new Error('Broken zip directory');
		return { count, offset, size };
	}
	throw new Error('Not a zip file');
}

export function parseZipEntries(directory: Uint8Array, count: number): Map<string, ZipEntry> {
	const directoryView = view(directory);
	const decoder = new TextDecoder();
	const entries = new Map<string, ZipEntry>();
	let offset = 0;
	for (let i = 0; i < count; i++) {
		if (
			offset + 46 > directory.length ||
			directoryView.getUint32(offset, true) !== CENTRAL_SIGNATURE
		)
			throw new Error('Broken zip directory');
		const nameLength = directoryView.getUint16(offset + 28, true);
		const extraLength = directoryView.getUint16(offset + 30, true);
		const commentLength = directoryView.getUint16(offset + 32, true);
		const name = decoder.decode(directory.subarray(offset + 46, offset + 46 + nameLength));
		entries.set(name, {
			name,
			method: directoryView.getUint16(offset + 10, true),
			crc: directoryView.getUint32(offset + 16, true),
			compressedSize: directoryView.getUint32(offset + 20, true),
			size: directoryView.getUint32(offset + 24, true),
			localOffset: directoryView.getUint32(offset + 42, true)
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

export function unpackZipEntry(entry: ZipEntry, data: Uint8Array): Uint8Array {
	let content: Uint8Array;
	if (entry.method === 0) content = data;
	else if (entry.method === 8) content = new Uint8Array(inflateRawSync(data));
	else throw new Error(`Unsupported zip compression ${entry.method}`);
	if (content.length !== entry.size || crc32(content) !== entry.crc)
		throw new Error(`${entry.name} is corrupt`);
	return content;
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Uint8Array> {
	const buffer = new Uint8Array(length);
	let done = 0;
	while (done < length) {
		const { bytesRead } = await file.read(buffer, done, length - done, position + done);
		if (bytesRead === 0) throw new Error('Unexpected end of zip file');
		done += bytesRead;
	}
	return buffer;
}

export async function openZipFile(path: string): Promise<ZipReader> {
	const file = await open(path, 'r');
	try {
		const { size } = await file.stat();
		const tailStart = Math.max(0, size - EOCD_SIZE - MAX_COMMENT);
		const tail = await readAt(file, tailStart, size - tailStart);
		const directory = parseZipDirectory(tail, tailStart);
		const entries = parseZipEntries(
			await readAt(file, directory.offset, directory.size),
			directory.count
		);

		return {
			entries,
			async read(entry) {
				const header = view(await readAt(file, entry.localOffset, 30));
				if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error('Broken zip entry');
				const dataStart =
					entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
				return unpackZipEntry(entry, await readAt(file, dataStart, entry.compressedSize));
			},
			close: () => file.close()
		};
	} catch (error) {
		await file.close();
		throw error;
	}
}

interface WrittenEntry {
	name: Uint8Array;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	offset: number;
}

export class ZipWriter {
	private stream: WriteStream;
	private offset = 0;
	private written: WrittenEntry[] = [];
	private encoder = new TextEncoder();

	constructor(path: string) {
		this.stream = createWriteStream(path);
	}

	async add(name: string, content: Uint8Array, compress = false): Promise<void> {
		const crc = crc32(content);
		const deflated = compress ? new Uint8Array(deflateRawSync(content)) : null;
		const useDeflate = deflated !== null && deflated.length < content.length;
		const data = useDeflate ? deflated : content;
		const method = useDeflate ? 8 : 0;
		const encodedName = this.encoder.encode(name);
		if (this.offset + 30 + encodedName.length + data.length > MAX_ZIP32)
			throw new Error('The pack is larger than 4 GB, which zip files without Zip64 cannot hold');

		const header = new Uint8Array(30 + encodedName.length);
		const headerView = view(header);
		headerView.setUint32(0, LOCAL_SIGNATURE, true);
		headerView.setUint16(4, 20, true);
		headerView.setUint16(6, UTF8_FLAG, true);
		headerView.setUint16(8, method, true);
		headerView.setUint16(12, 0x21, true);
		headerView.setUint32(14, crc, true);
		headerView.setUint32(18, data.length, true);
		headerView.setUint32(22, content.length, true);
		headerView.setUint16(26, encodedName.length, true);
		header.set(encodedName, 30);

		this.written.push({
			name: encodedName,
			method,
			crc,
			compressedSize: data.length,
			size: content.length,
			offset: this.offset
		});
		await this.write(header);
		await this.write(data);
	}

	async close(): Promise<void> {
		const start = this.offset;
		for (const entry of this.written) {
			const record = new Uint8Array(46 + entry.name.length);
			const recordView = view(record);
			recordView.setUint32(0, CENTRAL_SIGNATURE, true);
			recordView.setUint16(4, 20, true);
			recordView.setUint16(6, 20, true);
			recordView.setUint16(8, UTF8_FLAG, true);
			recordView.setUint16(10, entry.method, true);
			recordView.setUint16(14, 0x21, true);
			recordView.setUint32(16, entry.crc, true);
			recordView.setUint32(20, entry.compressedSize, true);
			recordView.setUint32(24, entry.size, true);
			recordView.setUint16(28, entry.name.length, true);
			recordView.setUint32(42, entry.offset, true);
			record.set(entry.name, 46);
			await this.write(record);
		}
		const end = new Uint8Array(EOCD_SIZE);
		const endView = view(end);
		endView.setUint32(0, EOCD_SIGNATURE, true);
		endView.setUint16(8, this.written.length, true);
		endView.setUint16(10, this.written.length, true);
		endView.setUint32(12, this.offset - start, true);
		endView.setUint32(16, start, true);
		await this.write(end);
		await new Promise<void>((resolve, reject) => {
			this.stream.once('error', reject);
			this.stream.end(resolve);
		});
	}

	private write(bytes: Uint8Array): Promise<void> {
		this.offset += bytes.length;
		return new Promise((resolve, reject) => {
			this.stream.write(bytes, (error) => (error ? reject(error) : resolve()));
		});
	}
}
