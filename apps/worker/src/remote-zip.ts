import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
	name: string;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	localOffset: number;
}

export interface RemoteZip {
	entries: Map<string, ZipEntry>;
	read(entry: ZipEntry): Promise<Uint8Array>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const timeoutMs = 120_000;

export async function openRemoteZip(
	url: string,
	fetchImpl: typeof fetch = fetch
): Promise<RemoteZip> {
	let whole: Uint8Array | null = null;

	const readRange = async (start: number, length: number): Promise<Uint8Array> => {
		if (whole) return whole.subarray(start, start + length);
		const response = await fetchImpl(url, {
			headers: { range: `bytes=${start}-${start + length - 1}` },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (response.status === 200) {
			whole = new Uint8Array(await response.arrayBuffer());
			return whole.subarray(start, start + length);
		}
		if (response.status !== 206) throw new Error(`Download failed (${response.status}): ${url}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.length !== length) throw new Error(`Got ${bytes.length} bytes, expected ${length}`);
		return bytes;
	};

	const size = await totalSize(url, fetchImpl, (bytes) => (whole = bytes));
	const tailStart = Math.max(0, size - EOCD_SIZE - MAX_COMMENT);
	const tail = await readRange(tailStart, size - tailStart);
	const tailView = view(tail);

	let eocd = -1;
	for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
		if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('Not a zip file');

	const count = tailView.getUint16(eocd + 10, true);
	const directorySize = tailView.getUint32(eocd + 12, true);
	const directoryOffset = tailView.getUint32(eocd + 16, true);
	if (count === 0xffff || directoryOffset === 0xffffffff) throw new Error('Zip64 is not supported');

	const directory =
		directoryOffset >= tailStart
			? tail.subarray(directoryOffset - tailStart, directoryOffset - tailStart + directorySize)
			: await readRange(directoryOffset, directorySize);
	const directoryView = view(directory);
	const decoder = new TextDecoder();
	const entries = new Map<string, ZipEntry>();

	let offset = 0;
	for (let i = 0; i < count; i++) {
		if (directoryView.getUint32(offset, true) !== CENTRAL_SIGNATURE)
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

	return {
		entries,
		async read(entry) {
			const header = view(await readRange(entry.localOffset, 30));
			if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error('Broken zip entry');
			const dataStart =
				entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
			const data = await readRange(dataStart, entry.compressedSize);

			let content: Uint8Array;
			if (entry.method === 0) content = data;
			else if (entry.method === 8) content = new Uint8Array(inflateRawSync(data));
			else throw new Error(`Unsupported zip compression ${entry.method}`);

			if (content.length !== entry.size || crc32(content) !== entry.crc)
				throw new Error(`${entry.name} is corrupt`);
			return content;
		}
	};
}

async function totalSize(
	url: string,
	fetchImpl: typeof fetch,
	keepWhole: (bytes: Uint8Array) => void
): Promise<number> {
	const response = await fetchImpl(url, {
		headers: { range: 'bytes=0-0' },
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (response.status === 200) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		keepWhole(bytes);
		return bytes.length;
	}
	await response.body?.cancel();
	const total = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1];
	if (response.status !== 206 || !total)
		throw new Error(`Download failed (${response.status}): ${url}`);
	return Number(total);
}

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
