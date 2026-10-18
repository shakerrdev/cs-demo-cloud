import { weaponKey, type RoundColumns } from '@cs-demo-cloud/replay';

const MAX_RESERVE: Record<string, number> = {
	ak47: 90,
	aug: 90,
	awp: 30,
	bizon: 120,
	cz75a: 12,
	deagle: 35,
	elite: 120,
	famas: 90,
	fiveseven: 100,
	g3sg1: 90,
	galilar: 90,
	glock: 120,
	hkp2000: 52,
	m249: 200,
	m4a1: 90,
	m4a1_silencer: 80,
	mac10: 100,
	mag7: 32,
	mp5sd: 120,
	mp7: 120,
	mp9: 120,
	negev: 300,
	nova: 32,
	p250: 26,
	p90: 100,
	revolver: 8,
	sawedoff: 32,
	scar20: 90,
	sg556: 90,
	ssg08: 90,
	tec9: 90,
	ump45: 100,
	usp_silencer: 24,
	xm1014: 32
};

export function estimateReserve(
	cols: RoundColumns,
	players: number,
	frames: number,
	weapons: string[]
): void {
	if (!cols.reserve || !cols.clip) return;
	for (let p = 0; p < players; p++) {
		const known = cols.reserve.subarray(p * frames, (p + 1) * frames).some((value) => value > 1);
		if (known) continue;
		const reserves = new Map<number, number>();
		let lastWeapon = -1;
		let lastClip = 0;
		for (let f = 0; f < frames; f++) {
			const at = p * frames + f;
			const weapon = cols.weapon[at]!;
			const clip = cols.clip[at]!;
			const key = weaponKey(weapons[weapon] ?? '');
			const max = key ? MAX_RESERVE[key] : undefined;
			if (max === undefined) {
				cols.reserve[at] = 0;
				lastWeapon = weapon;
				continue;
			}
			let reserve = reserves.get(weapon) ?? max;
			if (weapon === lastWeapon && clip > lastClip)
				reserve = Math.max(0, reserve - (clip - lastClip));
			reserves.set(weapon, reserve);
			cols.reserve[at] = Math.min(255, reserve);
			lastWeapon = weapon;
			lastClip = clip;
		}
	}
}
