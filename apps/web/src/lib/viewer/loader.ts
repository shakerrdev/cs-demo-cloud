import { decodeRound, type RoundReplay } from '@cs-demo-cloud/replay';

const cache = new Map<string, Promise<RoundReplay>>();

export function loadRound(demoId: string, version: number, round: number): Promise<RoundReplay> {
	const key = `${demoId}/${version}/${round}`;
	let pending = cache.get(key);
	if (!pending) {
		pending = fetch(`/api/demos/${demoId}/rounds/${round}?v=${version}`)
			.then((response) => {
				if (!response.ok)
					throw new Error(`Round ${round} could not be loaded (${response.status})`);
				return response.arrayBuffer();
			})
			.then((buffer) => decodeRound(buffer));
		pending.catch(() => cache.delete(key));
		cache.set(key, pending);
	}
	return pending;
}
