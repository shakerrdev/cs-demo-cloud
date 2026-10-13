const WINDOW_MS = 15 * 60_000;

interface Bucket {
	count: number;
	since: number;
}

export function createRateLimit(limit: number, windowMs = WINDOW_MS) {
	const buckets = new Map<string, Bucket>();

	const current = (key: string, now: number) => {
		const bucket = buckets.get(key);
		if (bucket && now - bucket.since < windowMs) return bucket;
		buckets.delete(key);
		return null;
	};

	return {
		blocked(key: string): boolean {
			return (current(key, Date.now())?.count ?? 0) >= limit;
		},
		hit(key: string): void {
			const now = Date.now();
			const bucket = current(key, now);
			if (bucket) bucket.count++;
			else buckets.set(key, { count: 1, since: now });
			if (buckets.size > 10_000) {
				for (const [stale, value] of buckets)
					if (now - value.since >= windowMs) buckets.delete(stale);
			}
		},
		reset(key: string): void {
			buckets.delete(key);
		}
	};
}
