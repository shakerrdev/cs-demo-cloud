import { kv3Array, kv3Object, type Kv3Object, type Kv3Value } from './kv3.ts';

export interface SoundEvent {
	files: string[];
	volume: number;
	pitch: number;
	curve: number[];
}

export function collectSoundEvents(scripts: Kv3Value[]): Map<string, Kv3Object> {
	const events = new Map<string, Kv3Object>();
	for (const script of scripts) {
		for (const [name, value] of Object.entries(kv3Object(script) ?? {})) {
			const event = kv3Object(value);
			if (event) events.set(name.toLowerCase(), event);
		}
	}
	return events;
}

function vsndFiles(event: Kv3Object): string[] {
	return Object.entries(event)
		.filter(([key]) => key.startsWith('vsnd_files'))
		.flatMap(([, value]) => (typeof value === 'string' ? [value] : kv3Array(value)))
		.filter((file): file is string => typeof file === 'string' && file.endsWith('.vsnd'));
}

function curvePoints(value: Kv3Value | undefined): number[] {
	return kv3Array(value).flatMap((point) => {
		const [distance, volume] = kv3Array(point);
		return typeof distance === 'number' && typeof volume === 'number' ? [distance, volume] : [];
	});
}

export function resolveSoundEvent(
	events: Map<string, Kv3Object>,
	name: string,
	depth = 0
): SoundEvent | null {
	const event = events.get(name.toLowerCase());
	if (!event || depth > 4) return null;
	const base =
		typeof event.base === 'string' && event.base
			? resolveSoundEvent(events, event.base, depth + 1)
			: null;

	let files = vsndFiles(event);
	if (!files.length) {
		for (const [key, value] of Object.entries(event)) {
			if (!key.startsWith('soundevent_') || typeof value !== 'string' || !value) continue;
			const child = resolveSoundEvent(events, value, depth + 1);
			if (child?.files.length) {
				files = child.files;
				break;
			}
		}
	}
	if (!files.length && base) files = base.files;
	if (!files.length) return null;

	const curve = curvePoints(event.distance_volume_mapping_curve);
	return {
		files,
		volume: typeof event.volume === 'number' ? event.volume : (base?.volume ?? 1),
		pitch: typeof event.pitch === 'number' ? event.pitch : (base?.pitch ?? 1),
		curve: curve.length ? curve : (base?.curve ?? [])
	};
}

function chunk(view: DataView, id: string, start = 12): { offset: number; size: number } | null {
	let offset = start;
	while (offset + 8 <= view.byteLength) {
		const name = String.fromCharCode(
			view.getUint8(offset),
			view.getUint8(offset + 1),
			view.getUint8(offset + 2),
			view.getUint8(offset + 3)
		);
		const size = view.getUint32(offset + 4, true);
		if (name === id)
			return { offset: offset + 8, size: Math.min(size, view.byteLength - offset - 8) };
		offset += 8 + size + (size & 1);
	}
	return null;
}

export function monoWav(wav: Uint8Array): Uint8Array {
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	if (wav.length < 12 || view.getUint32(0, false) !== 0x52494646) throw new Error('Not a WAV file');
	const format = chunk(view, 'fmt ');
	const data = chunk(view, 'data');
	if (!format || !data) throw new Error('WAV file without fmt or data');
	const audioFormat = view.getUint16(format.offset, true);
	const channels = view.getUint16(format.offset + 2, true);
	const sampleRate = view.getUint32(format.offset + 4, true);
	const bits = view.getUint16(format.offset + 14, true);
	if (audioFormat !== 1 || bits !== 16) return wav;

	const frames = Math.floor(data.size / (2 * channels));
	const out = new Uint8Array(44 + frames * 2);
	const o = new DataView(out.buffer);
	for (let i = 0; i < frames; i++) {
		let sum = 0;
		for (let c = 0; c < channels; c++)
			sum += view.getInt16(data.offset + (i * channels + c) * 2, true);
		o.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(sum / channels))), true);
	}
	const text = (offset: number, value: string) => {
		for (let i = 0; i < 4; i++) o.setUint8(offset + i, value.charCodeAt(i));
	};
	text(0, 'RIFF');
	o.setUint32(4, out.length - 8, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	o.setUint32(16, 16, true);
	o.setUint16(20, 1, true);
	o.setUint16(22, 1, true);
	o.setUint32(24, sampleRate, true);
	o.setUint32(28, sampleRate * 2, true);
	o.setUint16(32, 2, true);
	o.setUint16(34, 16, true);
	text(36, 'data');
	o.setUint32(40, frames * 2, true);
	return out;
}
