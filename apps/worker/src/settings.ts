import type { ReplaySkin } from '@cs-demo-cloud/replay';
import { num, str, type RawSkin, type SettingRows } from './parser.ts';

export interface PlayerSettings {
	crosshair?: string;
	viewmodel?: [number, number, number, number];
	musicKit?: number;
}

const CROSSHAIR = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

export function isGloves(item: number): boolean {
	return item === 4725 || (item >= 5027 && item <= 5099);
}

function wearOf(bits: number): number {
	const view = new DataView(new ArrayBuffer(4));
	view.setUint32(0, bits >>> 0);
	const wear = view.getFloat32(0);
	return Number.isFinite(wear) && wear >= 0 && wear <= 1 ? Math.round(wear * 1e6) / 1e6 : 0;
}

export function glovesBySteamId(skins: RawSkin[]): Map<string, ReplaySkin> {
	const gloves = new Map<string, ReplaySkin>();
	for (const skin of skins) {
		const item = num(skin.def_index);
		const paint = num(skin.paint_index);
		if (!skin.steamid || !isGloves(item) || paint <= 0 || gloves.has(skin.steamid)) continue;
		gloves.set(skin.steamid, {
			item,
			paint,
			seed: num(skin.paint_seed),
			wear: wearOf(num(skin.paint_wear))
		});
	}
	return gloves;
}

export function settingsAt(
	rows: SettingRows,
	tick: number,
	keyOf: (steamid: unknown, name: unknown) => string
): Map<string, PlayerSettings> {
	const out = new Map<string, PlayerSettings>();
	for (let i = 0; i < rows.tick.length; i++) {
		if (rows.tick[i] !== tick) continue;
		const settings: PlayerSettings = {};
		const code = str(rows.crosshair_code[i]);
		if (code && CROSSHAIR.test(code)) settings.crosshair = code;
		const fov = num(rows['CCSPlayerPawn.m_flViewmodelFOV'][i]);
		if (fov >= 40 && fov <= 90) {
			settings.viewmodel = [
				fov,
				num(rows['CCSPlayerPawn.m_flViewmodelOffsetX'][i]),
				num(rows['CCSPlayerPawn.m_flViewmodelOffsetY'][i]),
				num(rows['CCSPlayerPawn.m_flViewmodelOffsetZ'][i])
			];
		}
		const kit = num(rows.music_kit_id[i]);
		if (kit > 0) settings.musicKit = kit;
		out.set(keyOf(rows.steamid[i], rows.name[i]), settings);
	}
	return out;
}
