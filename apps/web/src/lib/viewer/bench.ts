import { profiler, summarize, type PerfSummary } from './perf.ts';
import { defaultDebug, type DebugToggles, type GraphicsSettings } from './graphics.ts';
import type { ReplayScene } from './three/scene.ts';

export interface BenchCase {
	name: string;
	graphics?: Partial<GraphicsSettings>;
	debug?: Partial<DebugToggles>;
}

export interface BenchResult {
	name: string;
	summary: PerfSummary;
	scale: number;
	drawing: { width: number; height: number };
}

export const benchCases: BenchCase[] = [
	{ name: 'baseline' },
	{ name: 'resolution 70%', graphics: { resolution: 0.7 } },
	{ name: 'resolution 50%', graphics: { resolution: 0.5 } },
	{ name: 'msaa off', graphics: { msaa: 0 } },
	{ name: 'msaa 2x', graphics: { msaa: 2 } },
	{ name: 'bloom off', debug: { bloom: false } },
	{ name: 'no map', debug: { world: false } },
	{ name: 'no player models', debug: { models: false } },
	{ name: 'no x-ray ghosts', debug: { ghosts: false } },
	{ name: 'no viewmodel', debug: { viewmodel: false } },
	{ name: 'no effects', debug: { effects: false } },
	{ name: 'no overlay', debug: { overlay: false } },
	{ name: 'depth prepass', debug: { prepass: true } },
	{ name: '11-bit colour', debug: { compactColor: true } },
	{ name: 'baseline again' }
];

const WARMUP_MS = 700;
const MEASURE_MS = 2500;
const MIN_FRAMES = 30;
const MAX_MS = 15000;

export class Benchmark {
	results: BenchResult[] = [];
	done = false;
	private index = -1;
	private phaseStart = 0;
	private measuring = false;
	private from = 0;
	private scene: ReplayScene;
	private base: GraphicsSettings;
	onProgress: ((text: string) => void) | null = null;
	onCase: (() => void) | null = null;

	constructor(scene: ReplayScene, base: GraphicsSettings) {
		this.scene = scene;
		this.base = base;
	}

	step(now: number) {
		if (this.done) return;
		if (this.index < 0) {
			this.next(now);
			return;
		}
		const elapsed = now - this.phaseStart;
		if (!this.measuring && elapsed >= WARMUP_MS) {
			this.measuring = true;
			this.from = profiler.now();
		} else if (this.measuring && elapsed >= WARMUP_MS + MEASURE_MS) {
			const frames = profiler.frames.filter((f) => f.t >= this.from && f.interval > 0);
			if (frames.length < MIN_FRAMES && elapsed < MAX_MS) return;
			this.results.push({
				name: benchCases[this.index]!.name,
				summary: summarize(frames),
				scale: this.scene.renderScale,
				drawing: this.scene.drawingSize
			});
			this.next(now);
		}
	}

	cancel() {
		this.finish();
	}

	private next(now: number) {
		this.index++;
		const test = benchCases[this.index];
		if (!test) {
			this.finish();
			return;
		}
		this.onProgress?.(`${this.index + 1}/${benchCases.length}: ${test.name}`);
		profiler.note(`bench ${test.name}`);
		const base =
			this.base.resolution === 'auto' ? { ...this.base, resolution: 1 as const } : this.base;
		this.scene.setGraphics({ ...base, ...test.graphics });
		this.scene.debug = { ...this.scene.debug, ...defaultDebug, ...test.debug };
		this.scene.syncTiming = true;
		this.phaseStart = now;
		this.measuring = false;
		this.onCase?.();
	}

	private finish() {
		if (this.done) return;
		this.done = true;
		this.scene.setGraphics(this.base);
		this.scene.debug = { ...defaultDebug };
		this.scene.syncTiming = false;
		this.onProgress?.('done');
	}
}
