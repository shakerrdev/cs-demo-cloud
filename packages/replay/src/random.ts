const NTAB = 32;
const IA = 16807;
const IM = 2147483647;
const IQ = 127773;
const IR = 2836;
const NDIV = 1 + Math.floor((IM - 1) / NTAB);
const AM = 1 / IM;
const RNMX = 1 - 1.2e-7;

export class UniformRandomStream {
	private idum = 0;
	private iy = 0;
	private iv = new Array<number>(NTAB).fill(0);

	constructor(seed: number) {
		this.idum = seed < 0 ? seed : -seed;
	}

	private step() {
		const k = Math.trunc(this.idum / IQ);
		this.idum = IA * (this.idum - k * IQ) - IR * k;
		if (this.idum < 0) this.idum += IM;
	}

	next(): number {
		if (this.idum <= 0 || !this.iy) {
			this.idum = -this.idum < 1 ? 1 : -this.idum;
			for (let j = NTAB + 7; j >= 0; j--) {
				this.step();
				if (j < NTAB) this.iv[j] = this.idum;
			}
			this.iy = this.iv[0]!;
		}
		this.step();
		const j = Math.trunc(this.iy / NDIV);
		this.iy = this.iv[j]!;
		this.iv[j] = this.idum;
		return this.iy;
	}

	float(low: number, high: number): number {
		const value = Math.min(Math.fround(AM * this.next()), RNMX);
		return value * (high - low) + low;
	}
}

export type PaintRoll = [name: string, component: number, min: number, max: number];

export function rollPaint(rolls: PaintRoll[], seed: number): Map<string, Map<number, number>> {
	const random = new UniformRandomStream(seed);
	const out = new Map<string, Map<number, number>>();
	for (const [name, component, min, max] of rolls) {
		let values = out.get(name);
		if (!values) out.set(name, (values = new Map()));
		values.set(component, random.float(min, max));
	}
	return out;
}
