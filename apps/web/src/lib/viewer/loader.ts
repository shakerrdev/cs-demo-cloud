import {
	MAP_MESH_VERSION,
	decodeMapMesh,
	decodeRound,
	type MapMesh,
	type RoundReplay
} from '@cs-demo-cloud/replay';

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

const meshes = new Map<string, Promise<MapMesh | null>>();

export function loadMapMesh(map: string): Promise<MapMesh | null> {
	let pending = meshes.get(map);
	if (!pending) {
		pending = fetch(`/maps/${map}.mesh?v=${MAP_MESH_VERSION}`).then((response) => {
			if (response.status === 404) return null;
			if (!response.ok) throw new Error(`The 3D map could not be loaded (${response.status})`);
			return response.arrayBuffer().then((buffer) => decodeMapMesh(buffer));
		});
		pending.catch(() => meshes.delete(map));
		meshes.set(map, pending);
	}
	return pending;
}
