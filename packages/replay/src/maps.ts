export interface MapInfo {
	name: string;
	title: string;
	posX: number;
	posY: number;
	scale: number;
	lowerBelowZ: number | null;
}

type MapRow = [
	name: string,
	title: string,
	posX: number,
	posY: number,
	scale: number,
	lowerBelowZ?: number
];

const rows: MapRow[] = [
	['cs_agency', 'Agency', -2597, 2079, 4.1817436],
	['cs_alpine', 'Alpine', -2107, 4687, 6.5296063],
	['cs_assault', 'Assault', 4041, 7838, 4.6],
	['cs_italy', 'Italy', -2647, 2592, 4.6],
	['cs_militia', 'Militia', -1474, 2296, 4.5, 25],
	['cs_office', 'Office', -1838, 1858, 4.1],
	['cs_shelter', 'Shelter', -3448, 3805, 3.311857],
	['de_ancient', 'Ancient', -2953, 2164, 5],
	['de_anubis', 'Anubis', -2796, 3328, 5.22],
	['de_assembly', 'Assembly', 1628, 4512, 2.84],
	['de_aztec', 'Aztec', -3200, 2841, 6],
	['de_basalt', 'Basalt', -2345, 2391, 4.37],
	['de_boulder', 'Boulder', -3273, 2930, 2.8491137, 62],
	['de_brewery', 'Brewery', -4122, 4394, 2.1820312],
	['de_cache', 'Cache', -2000, 3250, 5.5],
	['de_canals', 'Canals', -2496, 1792, 4],
	['de_cbble', 'Cobblestone', -3840, 3072, 6],
	['de_debris', 'Debris', -3015, 2919, 1.9445695],
	['de_dogtown', 'Dogtown', -1741, 3295, 2.0323243],
	['de_dust', 'Dust', -2850, 4073, 6],
	['de_dust2', 'Dust II', -2476, 3239, 4.4],
	['de_edin', 'Edin', -383, 4420, 4.803717],
	['de_eldorado', 'Eldorado', -3548, 2571, 2.0656068],
	['de_fachwerk', 'Fachwerk', -2311, 2874, 2.5537856],
	['de_golden', 'Golden', -856, 2399, 4.506695],
	['de_grail', 'Grail', -4395, 4203, 2.1756864],
	['de_inferno', 'Inferno', -2087, 3870, 4.9],
	['de_jura', 'Jura', -2126, 2389, 2.504188],
	['de_memento', 'Memento', -2111, 2534, 3.9720395],
	['de_mills', 'Mills', -4810, -320, 5.148437],
	['de_mirage', 'Mirage', -3230, 1713, 5],
	['de_nuke', 'Nuke', -3453, 2887, 7, -495],
	['de_overpass', 'Overpass', -4831, 1781, 5.2],
	['de_palacio', 'Palacio', -2443, 1896, 3.8676212],
	['de_palais', 'Palais', -1353, 2044, 2.8003397, 103],
	['de_poseidon', 'Poseidon', -1046, 1166, 3.0124886],
	['de_rooftop', 'Rooftop', -1847, 2301, 1.914732],
	['de_sanctum', 'Sanctum', -1846, 674, 3.658203],
	['de_stronghold', 'Stronghold', -2786, 2598, 2.9476247],
	['de_thera', 'Thera', -85, 2261, 4.846961, -4],
	['de_train', 'Train', -2308, 2078, 4.082077],
	['de_vertigo', 'Vertigo', -3168, 1762, 4, 11700],
	['de_warden', 'Warden', -3150, 2681, 5.642361],
	['de_whistle', 'Whistle', -1825, 1104, 2.8]
];

export const maps: Record<string, MapInfo> = Object.fromEntries(
	rows.map(([name, title, posX, posY, scale, lowerBelowZ]) => [
		name,
		{ name, title, posX, posY, scale, lowerBelowZ: lowerBelowZ ?? null }
	])
);

export function mapTitle(name: string): string {
	return maps[name]?.title ?? name.replace(/^(de|cs|ar)_/, '').replace(/_/g, ' ');
}

export function worldToRadar(map: MapInfo, radarSize: number, x: number, y: number) {
	return {
		u: (x - map.posX) / map.scale / radarSize,
		v: (map.posY - y) / map.scale / radarSize
	};
}
