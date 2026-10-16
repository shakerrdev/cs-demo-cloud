import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import type { PackTexture, TextureFormat } from '@cs-demo-cloud/replay';

export interface Image {
	width: number;
	height: number;
	rgba: Uint8Array;
}

export function decodePng(bytes: Uint8Array): Image {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0) !== 0x89504e47) throw new Error('Not a PNG');
	let offset = 8;
	let width = 0;
	let height = 0;
	let depth = 0;
	let type = 0;
	let interlace = 0;
	const chunks: Uint8Array[] = [];
	while (offset < bytes.length) {
		const length = view.getUint32(offset);
		const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const data = bytes.subarray(offset + 8, offset + 8 + length);
		if (name === 'IHDR') {
			const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
			width = header.getUint32(0);
			height = header.getUint32(4);
			depth = data[8]!;
			type = data[9]!;
			interlace = data[12]!;
		} else if (name === 'IDAT') chunks.push(data);
		else if (name === 'IEND') break;
		offset += 12 + length;
	}
	if (depth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(type))
		throw new Error(`Unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
	const channels = type === 0 ? 1 : type === 2 ? 3 : type === 4 ? 2 : 4;
	const raw = inflateSync(Buffer.concat(chunks));
	const stride = width * channels;
	const pixels = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]!;
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const out = pixels.subarray(y * stride, (y + 1) * stride);
		const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? out[x - channels]! : 0;
			const b = previous ? previous[x]! : 0;
			const c = previous && x >= channels ? previous[x - channels]! : 0;
			let value = line[x]!;
			if (filter === 1) value += a;
			else if (filter === 2) value += b;
			else if (filter === 3) value += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[x] = value & 255;
		}
	}
	const rgba = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const s = i * channels;
		const gray = pixels[s]!;
		rgba[i * 4] = gray;
		rgba[i * 4 + 1] = channels >= 3 ? pixels[s + 1]! : gray;
		rgba[i * 4 + 2] = channels >= 3 ? pixels[s + 2]! : gray;
		rgba[i * 4 + 3] = channels === 4 ? pixels[s + 3]! : channels === 2 ? pixels[s + 1]! : 255;
	}
	return { width, height, rgba };
}

export function halve(image: Image): Image {
	const width = Math.max(1, image.width >> 1);
	const height = Math.max(1, image.height >> 1);
	const rgba = new Uint8Array(width * height * 4);
	const sx = image.width > 1 ? 2 : 1;
	const sy = image.height > 1 ? 2 : 1;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let dy = 0; dy < sy; dy++)
					for (let dx = 0; dx < sx; dx++)
						sum += image.rgba[((y * sy + dy) * image.width + x * sx + dx) * 4 + c]!;
				rgba[(y * width + x) * 4 + c] = Math.round(sum / (sx * sy));
			}
	return { width, height, rgba };
}

function block(image: Image, bx: number, by: number, out: Uint8Array) {
	for (let y = 0; y < 4; y++)
		for (let x = 0; x < 4; x++) {
			const px = Math.min(image.width - 1, bx * 4 + x);
			const py = Math.min(image.height - 1, by * 4 + y);
			out.set(
				image.rgba.subarray((py * image.width + px) * 4, (py * image.width + px) * 4 + 4),
				(y * 4 + x) * 4
			);
		}
}

function to565(r: number, g: number, b: number): number {
	return (
		((Math.round((r * 31) / 255) << 11) |
			(Math.round((g * 63) / 255) << 5) |
			Math.round((b * 31) / 255)) &
		0xffff
	);
}

function from565(c: number): [number, number, number] {
	const r = (c >> 11) & 31;
	const g = (c >> 5) & 63;
	const b = c & 31;
	return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function encodeColor(pixels: Uint8Array, out: Uint8Array, at: number) {
	const mean = [0, 0, 0];
	for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) mean[c]! += pixels[i * 4 + c]! / 16;
	const cov = [0, 0, 0, 0, 0, 0];
	for (let i = 0; i < 16; i++) {
		const r = pixels[i * 4]! - mean[0]!;
		const g = pixels[i * 4 + 1]! - mean[1]!;
		const b = pixels[i * 4 + 2]! - mean[2]!;
		cov[0]! += r * r;
		cov[1]! += r * g;
		cov[2]! += r * b;
		cov[3]! += g * g;
		cov[4]! += g * b;
		cov[5]! += b * b;
	}
	let axis = [1, 1, 1];
	for (let k = 0; k < 8; k++) {
		const next = [
			cov[0]! * axis[0]! + cov[1]! * axis[1]! + cov[2]! * axis[2]!,
			cov[1]! * axis[0]! + cov[3]! * axis[1]! + cov[4]! * axis[2]!,
			cov[2]! * axis[0]! + cov[4]! * axis[1]! + cov[5]! * axis[2]!
		];
		const length = Math.hypot(next[0]!, next[1]!, next[2]!);
		if (length < 1e-6) break;
		axis = next.map((v) => v / length);
	}
	let lo = Infinity;
	let hi = -Infinity;
	for (let i = 0; i < 16; i++) {
		const t =
			(pixels[i * 4]! - mean[0]!) * axis[0]! +
			(pixels[i * 4 + 1]! - mean[1]!) * axis[1]! +
			(pixels[i * 4 + 2]! - mean[2]!) * axis[2]!;
		if (t < lo) lo = t;
		if (t > hi) hi = t;
	}
	const clamp = (v: number) => Math.max(0, Math.min(255, v));
	const max = mean.map((m, c) => clamp(m + axis[c]! * hi));
	const min = mean.map((m, c) => clamp(m + axis[c]! * lo));
	let c0 = to565(max[0]!, max[1]!, max[2]!);
	let c1 = to565(min[0]!, min[1]!, min[2]!);
	if (c0 < c1) [c0, c1] = [c1, c0];
	let indices = 0;
	if (c0 !== c1) {
		const p0 = from565(c0);
		const p1 = from565(c1);
		const palette = [
			p0,
			p1,
			p0.map((v, c) => (2 * v + p1[c]!) / 3),
			p0.map((v, c) => (v + 2 * p1[c]!) / 3)
		];
		for (let i = 15; i >= 0; i--) {
			let best = 0;
			let bestDistance = Infinity;
			for (let k = 0; k < 4; k++) {
				const p = palette[k]!;
				const dr = pixels[i * 4]! - p[0]!;
				const dg = pixels[i * 4 + 1]! - p[1]!;
				const db = pixels[i * 4 + 2]! - p[2]!;
				const distance = dr * dr + dg * dg + db * db;
				if (distance < bestDistance) {
					bestDistance = distance;
					best = k;
				}
			}
			indices = (indices << 2) | best;
		}
	}
	out[at] = c0 & 255;
	out[at + 1] = c0 >> 8;
	out[at + 2] = c1 & 255;
	out[at + 3] = c1 >> 8;
	out[at + 4] = indices & 255;
	out[at + 5] = (indices >>> 8) & 255;
	out[at + 6] = (indices >>> 16) & 255;
	out[at + 7] = (indices >>> 24) & 255;
}

function encodeChannel(pixels: Uint8Array, channel: number, out: Uint8Array, at: number) {
	let min = 255;
	let max = 0;
	for (let i = 0; i < 16; i++) {
		const v = pixels[i * 4 + channel]!;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	out[at] = max;
	out[at + 1] = min;
	let bits = 0n;
	if (max !== min) {
		const palette = [max, min];
		for (let k = 1; k < 7; k++) palette.push(((7 - k) * max + k * min) / 7);
		for (let i = 0; i < 16; i++) {
			const v = pixels[i * 4 + channel]!;
			let best = 0;
			let bestDistance = Infinity;
			for (let k = 0; k < 8; k++) {
				const distance = Math.abs(v - palette[k]!);
				if (distance < bestDistance) {
					bestDistance = distance;
					best = k;
				}
			}
			bits |= BigInt(best) << BigInt(i * 3);
		}
	}
	for (let i = 0; i < 6; i++) out[at + 2 + i] = Number((bits >> BigInt(i * 8)) & 255n);
}

export function encodeImage(
	image: Image,
	format: 'bc1' | 'bc3' | 'bc4' | 'bc5' | 'rgba8'
): Uint8Array {
	if (format === 'rgba8') return image.rgba.slice();
	const bw = Math.ceil(image.width / 4);
	const bh = Math.ceil(image.height / 4);
	const size = format === 'bc1' || format === 'bc4' ? 8 : 16;
	const out = new Uint8Array(bw * bh * size);
	const pixels = new Uint8Array(64);
	for (let by = 0; by < bh; by++)
		for (let bx = 0; bx < bw; bx++) {
			block(image, bx, by, pixels);
			const at = (by * bw + bx) * size;
			if (format === 'bc1') encodeColor(pixels, out, at);
			else if (format === 'bc4') encodeChannel(pixels, 0, out, at);
			else if (format === 'bc5') {
				encodeChannel(pixels, 0, out, at);
				encodeChannel(pixels, 1, out, at + 8);
			} else {
				encodeChannel(pixels, 3, out, at);
				encodeColor(pixels, out, at + 8);
			}
		}
	return out;
}

export function resampledFormat(
	format: TextureFormat,
	image: Image
): 'bc1' | 'bc3' | 'bc4' | 'bc5' | 'rgba8' | null {
	if (format === 'bc4' || format === 'r8') return 'bc4';
	if (format === 'bc5') return 'bc5';
	if (format === 'bc1') return 'bc1';
	if (format === 'bc3' || format === 'bc7' || format === 'rgba8') {
		for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i]! < 250) return 'bc3';
		return 'bc1';
	}
	return null;
}

export function resampleTexture(
	source: PackTexture,
	png: Uint8Array,
	maxSize: number
): PackTexture | null {
	if (source.faces !== 1 || source.depth !== 1) return null;
	let image = decodePng(png);
	const format = resampledFormat(source.format, image);
	if (!format) return null;
	while (Math.max(image.width, image.height) > maxSize) image = halve(image);
	const mipData: Uint8Array[] = [];
	const width = image.width;
	const height = image.height;
	for (;;) {
		mipData.push(encodeImage(image, format));
		if (image.width === 1 && image.height === 1) break;
		image = halve(image);
	}
	return { ...source, format, width, height, mips: mipData.length, mipData };
}

export class ResamplePool {
	private workers: Worker[] = [];
	private idle: Worker[] = [];
	private waiting: (() => void)[] = [];
	private jobs = new Map<
		number,
		{ resolve: (texture: PackTexture | null) => void; reject: (error: Error) => void }
	>();
	private next = 0;

	constructor(size = Math.max(1, availableParallelism() - 1)) {
		for (let i = 0; i < size; i++) {
			const worker = new Worker(new URL('./resample-worker.ts', import.meta.url));
			worker.on(
				'message',
				(message: { id: number; result?: PackTexture | null; error?: string }) => {
					const job = this.jobs.get(message.id);
					this.jobs.delete(message.id);
					this.release(worker);
					if (!job) return;
					if (message.error) job.reject(new Error(message.error));
					else job.resolve(message.result ?? null);
				}
			);
			this.workers.push(worker);
			this.idle.push(worker);
		}
	}

	async resample(
		source: PackTexture,
		png: Uint8Array,
		maxSize: number
	): Promise<PackTexture | null> {
		const worker = await this.acquire();
		const id = this.next++;
		return new Promise((resolve, reject) => {
			this.jobs.set(id, { resolve, reject });
			worker.postMessage({ id, source: { ...source, mipData: [] }, png, maxSize });
		});
	}

	private acquire(): Promise<Worker> {
		const worker = this.idle.pop();
		if (worker) return Promise.resolve(worker);
		return new Promise((resolve) => this.waiting.push(() => resolve(this.idle.pop()!)));
	}

	private release(worker: Worker) {
		this.idle.push(worker);
		this.waiting.shift()?.();
	}

	async close() {
		await Promise.all(this.workers.map((worker) => worker.terminate()));
	}
}
