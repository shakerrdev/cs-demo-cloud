export interface FrameSample {
	t: number;
	interval: number;
	cpu: number;
	after: number;
	sections: Record<string, number>;
	gpu: Record<string, number> | null;
	draws: number;
	triangles: number;
}

export interface LongFrame {
	t: number;
	duration: number;
	blocking: number;
	render: number;
	style: number;
	scripts: { source: string; duration: number; invoker: string }[];
}

export interface PerfSummary {
	frames: number;
	fps: number;
	interval: Stats;
	cpu: Stats;
	after: Stats;
	sections: Record<string, Stats>;
	gpu: Record<string, Stats> | null;
	draws: number;
	triangles: number;
}

export interface Stats {
	avg: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
}

const CAPACITY = 7200;

export function stats(values: number[]): Stats {
	if (!values.length) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
	const sorted = [...values].sort((a, b) => a - b);
	const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
	const sum = values.reduce((a, b) => a + b, 0);
	return {
		avg: round(sum / values.length),
		p50: round(at(0.5)),
		p95: round(at(0.95)),
		p99: round(at(0.99)),
		max: round(sorted.at(-1)!)
	};
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

class GpuTimer {
	private gl: WebGL2RenderingContext;
	private ext: TimerExt;
	private pending: { frame: Record<string, number>; queries: [string, WebGLQuery][] }[] = [];
	private current: [string, WebGLQuery][] = [];
	private active = false;
	private pool: WebGLQuery[] = [];

	constructor(gl: WebGL2RenderingContext, ext: TimerExt) {
		this.gl = gl;
		this.ext = ext;
	}

	begin(name: string) {
		if (this.active) this.end();
		const query = this.pool.pop() ?? this.gl.createQuery();
		if (!query) return;
		this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
		this.current.push([name, query]);
		this.active = true;
	}

	end() {
		if (!this.active) return;
		this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
		this.active = false;
	}

	finishFrame(target: Record<string, number>) {
		this.end();
		if (this.current.length) this.pending.push({ frame: target, queries: this.current });
		this.current = [];
		if (this.pending.length > 8) {
			for (const [, query] of this.pending.shift()!.queries) this.pool.push(query);
		}
	}

	poll() {
		const gl = this.gl;
		const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
		while (this.pending.length) {
			const { frame, queries } = this.pending[0]!;
			const last = queries.at(-1)![1];
			if (!gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) break;
			this.pending.shift();
			for (const [name, query] of queries) {
				if (!disjoint) {
					const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
					frame[name] = (frame[name] ?? 0) + ns / 1e6;
				}
				this.pool.push(query);
			}
		}
	}
}

export class Profiler {
	enabled = false;
	readonly frames: FrameSample[] = [];
	readonly longFrames: LongFrame[] = [];
	readonly events: { t: number; text: string }[] = [];
	readonly origin = performance.now();
	gpuAvailable = false;
	private gpu: GpuTimer | null = null;
	private starts = new Map<string, number>();
	private sections: Record<string, number> = {};
	private frameStart = 0;
	private lastFrame = 0;
	private observer: PerformanceObserver | null = null;
	private info: (() => { draws: number; triangles: number }) | null = null;

	attachGl(gl: WebGL2RenderingContext, info: () => { draws: number; triangles: number }) {
		this.info = info;
		const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
		this.gpu = ext ? new GpuTimer(gl, ext) : null;
		this.gpuAvailable = this.gpu !== null;
	}

	detachGl() {
		this.gpu = null;
		this.info = null;
	}

	setEnabled(on: boolean) {
		if (on === this.enabled) return;
		this.enabled = on;
		this.lastFrame = 0;
		if (on) this.observe();
		else {
			this.observer?.disconnect();
			this.observer = null;
		}
	}

	clear() {
		this.frames.length = 0;
		this.longFrames.length = 0;
		this.events.length = 0;
	}

	note(text: string) {
		if (!this.enabled) return;
		this.events.push({ t: this.now(), text });
		if (this.events.length > 2000) this.events.shift();
	}

	now(): number {
		return performance.now() - this.origin;
	}

	beginFrame(now: number) {
		if (!this.enabled) return;
		this.frameStart = performance.now();
		this.sections = {};
		this.gpu?.poll();
		const interval = this.lastFrame ? now - this.lastFrame : 0;
		this.lastFrame = now;
		this.pendingInterval = interval;
	}

	private pendingInterval = 0;

	endFrame() {
		if (!this.enabled) return;
		const end = performance.now();
		const gpuFrame: Record<string, number> | null = this.gpu ? {} : null;
		if (this.gpu && gpuFrame) this.gpu.finishFrame(gpuFrame);
		const info = this.info?.() ?? { draws: 0, triangles: 0 };
		const sample: FrameSample = {
			t: round(this.frameStart - this.origin),
			interval: round(this.pendingInterval),
			cpu: round(end - this.frameStart),
			after: 0,
			sections: this.sections,
			gpu: gpuFrame,
			draws: info.draws,
			triangles: info.triangles
		};
		this.frames.push(sample);
		if (this.frames.length > CAPACITY) this.frames.shift();
		queueMicrotask(() => {
			sample.after = round(performance.now() - end);
		});
	}

	begin(name: string) {
		if (!this.enabled) return;
		this.starts.set(name, performance.now());
	}

	end(name: string) {
		if (!this.enabled) return;
		const start = this.starts.get(name);
		if (start === undefined) return;
		this.sections[name] = round((this.sections[name] ?? 0) + performance.now() - start);
		this.starts.delete(name);
	}

	gpuBegin(name: string) {
		if (this.enabled) this.gpu?.begin(name);
	}

	gpuEnd() {
		if (this.enabled) this.gpu?.end();
	}

	summary(seconds = 5): PerfSummary {
		const from = this.now() - seconds * 1000;
		const frames = this.frames.filter((f) => f.t >= from && f.interval > 0);
		return summarize(frames);
	}

	private observe() {
		if (typeof PerformanceObserver === 'undefined') return;
		const types = PerformanceObserver.supportedEntryTypes ?? [];
		const type = types.includes('long-animation-frame')
			? 'long-animation-frame'
			: types.includes('longtask')
				? 'longtask'
				: null;
		if (!type) return;
		this.observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const loaf = entry as PerformanceEntry & {
					blockingDuration?: number;
					renderStart?: number;
					styleAndLayoutStart?: number;
					scripts?: {
						sourceURL?: string;
						sourceFunctionName?: string;
						invoker?: string;
						duration: number;
					}[];
				};
				const end = entry.startTime + entry.duration;
				this.longFrames.push({
					t: round(entry.startTime - this.origin),
					duration: round(entry.duration),
					blocking: round(loaf.blockingDuration ?? 0),
					render: loaf.renderStart ? round(end - loaf.renderStart) : 0,
					style: loaf.styleAndLayoutStart ? round(end - loaf.styleAndLayoutStart) : 0,
					scripts: (loaf.scripts ?? [])
						.filter((s) => s.duration > 5)
						.map((s) => ({
							source: `${s.sourceFunctionName || '?'} ${(s.sourceURL ?? '').split('/').pop()}`,
							duration: round(s.duration),
							invoker: s.invoker ?? ''
						}))
				});
				if (this.longFrames.length > 1000) this.longFrames.shift();
			}
		});
		try {
			this.observer.observe({ type, buffered: false });
		} catch {
			this.observer = null;
		}
	}
}

export function summarize(frames: FrameSample[]): PerfSummary {
	const sectionNames = new Set(frames.flatMap((f) => Object.keys(f.sections)));
	const gpuFrames = frames.filter((f) => f.gpu && Object.keys(f.gpu).length);
	const gpuNames = new Set(gpuFrames.flatMap((f) => Object.keys(f.gpu!)));
	const interval = stats(frames.map((f) => f.interval));
	const gpuTotal = gpuFrames.map((f) => Object.values(f.gpu!).reduce((a, b) => a + b, 0));
	return {
		frames: frames.length,
		fps: interval.avg ? round(1000 / interval.avg) : 0,
		interval,
		cpu: stats(frames.map((f) => f.cpu)),
		after: stats(frames.map((f) => f.after)),
		sections: Object.fromEntries(
			[...sectionNames].map((name) => [name, stats(frames.map((f) => f.sections[name] ?? 0))])
		),
		gpu: gpuFrames.length
			? {
					total: stats(gpuTotal),
					...Object.fromEntries(
						[...gpuNames].map((name) => [name, stats(gpuFrames.map((f) => f.gpu![name] ?? 0))])
					)
				}
			: null,
		draws: Math.round(frames.reduce((a, f) => a + f.draws, 0) / Math.max(1, frames.length)),
		triangles: Math.round(frames.reduce((a, f) => a + f.triangles, 0) / Math.max(1, frames.length))
	};
}

export const profiler = new Profiler();

if (typeof window !== 'undefined')
	(window as unknown as { csdcProfiler: Profiler }).csdcProfiler = profiler;
