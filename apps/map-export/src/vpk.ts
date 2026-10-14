import { open, type FileHandle } from 'node:fs/promises';

const SIGNATURE = 0x55aa1234;
const IN_DIRECTORY = 0x7fff;

interface VpkFile {
	archive: number;
	offset: number;
	length: number;
	preload: Uint8Array;
}

async function readExactly(
	file: FileHandle,
	position: number,
	length: number
): Promise<Uint8Array> {
	const buffer = new Uint8Array(length);
	let done = 0;
	while (done < length) {
		const { bytesRead } = await file.read(buffer, done, length - done, position + done);
		if (bytesRead === 0) throw new Error('Unexpected end of VPK file');
		done += bytesRead;
	}
	return buffer;
}

export function parseVpkTree(tree: Uint8Array): Map<string, VpkFile> {
	const view = new DataView(tree.buffer, tree.byteOffset, tree.byteLength);
	const decoder = new TextDecoder();
	const files = new Map<string, VpkFile>();
	let i = 0;

	const readString = (): string => {
		const end = tree.indexOf(0, i);
		if (end < 0) throw new Error('Broken VPK directory');
		const value = decoder.decode(tree.subarray(i, end));
		i = end + 1;
		return value;
	};

	for (let extension = readString(); extension !== ''; extension = readString()) {
		for (let folder = readString(); folder !== ''; folder = readString()) {
			for (let name = readString(); name !== ''; name = readString()) {
				if (i + 18 > tree.length) throw new Error('Broken VPK directory');
				const preloadBytes = view.getUint16(i + 4, true);
				const archive = view.getUint16(i + 6, true);
				const offset = view.getUint32(i + 8, true);
				const length = view.getUint32(i + 12, true);
				if (view.getUint16(i + 16, true) !== 0xffff) throw new Error('Broken VPK entry');
				i += 18;
				const preload = tree.slice(i, i + preloadBytes);
				i += preloadBytes;

				const file = extension === ' ' ? name : `${name}.${extension}`;
				const path = folder === ' ' ? file : `${folder}/${file}`;
				files.set(path.toLowerCase(), { archive, offset, length, preload });
			}
		}
	}
	return files;
}

export class Vpk {
	readonly path: string;
	private dir: FileHandle;
	private dataStart: number;
	private files: Map<string, VpkFile>;
	private archives = new Map<number, FileHandle>();

	private constructor(
		path: string,
		dir: FileHandle,
		dataStart: number,
		files: Map<string, VpkFile>
	) {
		this.path = path;
		this.dir = dir;
		this.dataStart = dataStart;
		this.files = files;
	}

	static async open(path: string): Promise<Vpk> {
		const dir = await open(path, 'r');
		try {
			const head = new DataView((await readExactly(dir, 0, 12)).buffer);
			if (head.getUint32(0, true) !== SIGNATURE) throw new Error(`${path} is not a VPK`);
			const version = head.getUint32(4, true);
			if (version !== 1 && version !== 2) throw new Error(`Unsupported VPK version ${version}`);
			const treeSize = head.getUint32(8, true);
			const headerSize = version === 2 ? 28 : 12;
			const files = parseVpkTree(await readExactly(dir, headerSize, treeSize));
			return new Vpk(path, dir, headerSize + treeSize, files);
		} catch (error) {
			await dir.close();
			throw error;
		}
	}

	has(path: string): boolean {
		return this.files.has(path.toLowerCase());
	}

	list(prefix = ''): string[] {
		const lower = prefix.toLowerCase();
		return [...this.files.keys()].filter((path) => path.startsWith(lower));
	}

	size(path: string): number | undefined {
		const file = this.files.get(path.toLowerCase());
		return file ? file.preload.length + file.length : undefined;
	}

	async read(path: string): Promise<Uint8Array> {
		const file = this.files.get(path.toLowerCase());
		if (!file) throw new Error(`${path} is not in ${this.path}`);
		if (file.length === 0) return file.preload;

		const handle = file.archive === IN_DIRECTORY ? this.dir : await this.archive(file.archive);
		const position = file.archive === IN_DIRECTORY ? this.dataStart + file.offset : file.offset;
		const data = await readExactly(handle, position, file.length);
		if (file.preload.length === 0) return data;

		const out = new Uint8Array(file.preload.length + data.length);
		out.set(file.preload);
		out.set(data, file.preload.length);
		return out;
	}

	async close(): Promise<void> {
		await Promise.all([this.dir, ...this.archives.values()].map((handle) => handle.close()));
		this.archives.clear();
	}

	private async archive(index: number): Promise<FileHandle> {
		let handle = this.archives.get(index);
		if (!handle) {
			if (!/_dir\.vpk$/i.test(this.path)) throw new Error(`${this.path} has no archive ${index}`);
			const archivePath = this.path.replace(
				/_dir\.vpk$/i,
				`_${String(index).padStart(3, '0')}.vpk`
			);
			handle = await open(archivePath, 'r');
			this.archives.set(index, handle);
		}
		return handle;
	}
}
