import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import {
	PLAYER_PACK_MANIFEST,
	PLAYER_PACK_NAME,
	PLAYER_PACK_VERSION,
	playerClipNames,
	type PlayerPackManifest,
	type PlayerPackSound,
	type PlayerPackViewmodel,
	type PlayerPackWeapon,
	type Side,
	viewmodelClipNames,
	weaponClass
} from '@cs-demo-cloud/replay';
import { EXPORTER_VERSION, forEachLimit, PackBuilder } from './export.ts';
import { processModelGltf, type Gltf, type ModelGltfOptions, type ModelResult } from './gltf.ts';
import { gameBuild } from './steam.ts';
import type { Tools } from './tools.ts';
import { collectSoundEvents, monoWav, resolveSoundEvent, type SoundEvent } from './sounds.ts';
import { run, Vrf } from './vrf.ts';
import { Vpk } from './vpk.ts';

export interface PlayerExportOptions {
	csgo: string;
	outDir: string;
	workDir: string;
	tools: Tools;
	log: (message: string) => void;
	keepWork?: boolean;
	reuseWork?: boolean;
	maxTextureSize?: number;
}

const CHARACTERS: Record<Side, string> = {
	CT: 'agents/models/ctm_sas/ctm_sas.vmdl',
	T: 'agents/models/tm_phoenix/tm_phoenix.vmdl'
};
export const CHARACTER_MESHES = [
	'thirdperson_body',
	'thirdperson_default_gloves',
	'firstperson_default_gloves_arms',
	'firstperson_sleeves'
];
export const SKELETON_ROOT = 'root_motion';
export const WEAPON_BONE = 'weapon';

export const WEAPON_MODELS: Record<string, string> = {
	ak47: 'ak47/weapon_rif_ak47',
	aug: 'aug/weapon_rif_aug',
	awp: 'awp/weapon_snip_awp',
	bizon: 'bizon/weapon_smg_bizon',
	cz75a: 'cz75a/weapon_pist_cz75a',
	deagle: 'deagle/weapon_pist_deagle',
	elite: 'elite/weapon_pist_elite',
	famas: 'famas/weapon_rif_famas',
	fiveseven: 'fiveseven/weapon_pist_fiveseven',
	g3sg1: 'g3sg1/weapon_snip_g3sg1',
	galilar: 'galilar/weapon_rif_galilar',
	glock: 'glock18/weapon_pist_glock18',
	hkp2000: 'hkp2000/weapon_pist_hkp2000',
	m249: 'm249/weapon_mach_m249',
	m4a1_silencer: 'm4a1_silencer/weapon_rif_m4a1_silencer',
	m4a4: 'm4a4/weapon_rif_m4a4',
	mac10: 'mac10/weapon_smg_mac10',
	mag7: 'mag7/weapon_shot_mag7',
	mp5sd: 'mp5sd/weapon_smg_mp5sd',
	mp7: 'mp7/weapon_smg_mp7',
	mp9: 'mp9/weapon_smg_mp9',
	negev: 'negev/weapon_mach_negev',
	nova: 'nova/weapon_shot_nova',
	p250: 'p250/weapon_pist_p250',
	p90: 'p90/weapon_smg_p90',
	revolver: 'revolver/weapon_pist_revolver',
	sawedoff: 'sawedoff/weapon_shot_sawedoff',
	scar20: 'scar20/weapon_snip_scar20',
	sg556: 'sg556/weapon_rif_sg556',
	ssg08: 'ssg08/weapon_snip_ssg08',
	taser: 'taser/weapon_pist_taser',
	tec9: 'tec9/weapon_pist_tec9',
	ump45: 'ump45/weapon_smg_ump45',
	usp_silencer: 'usp_silencer/weapon_pist_usp_silencer',
	xm1014: 'xm1014/weapon_shot_xm1014',
	c4: 'c4/weapon_c4',
	hegrenade: 'grenade/hegrenade/weapon_hegrenade',
	flashbang: 'grenade/flashbang/weapon_flashbang',
	smokegrenade: 'grenade/smokegrenade/weapon_smokegrenade',
	molotov: 'grenade/molotov/weapon_molotov',
	incgrenade: 'grenade/incendiary/weapon_incendiarygrenade',
	decoy: 'grenade/decoy/weapon_decoy',
	knife_default_ct: 'knife/knife_default_ct/weapon_knife_default_ct',
	knife_default_t: 'knife/knife_default_t/weapon_knife_default_t',
	knife_bayonet: 'knife/knife_bayonet/weapon_knife_bayonet',
	knife_bowie: 'knife/knife_bowie/weapon_knife_bowie',
	knife_butterfly: 'knife/knife_butterfly/weapon_knife_butterfly',
	knife_canis: 'knife/knife_canis/weapon_knife_canis',
	knife_cord: 'knife/knife_cord/weapon_knife_cord',
	knife_css: 'knife/knife_css/weapon_knife_css',
	knife_falchion: 'knife/knife_falchion/weapon_knife_falchion',
	knife_flip: 'knife/knife_flip/weapon_knife_flip',
	knife_gut: 'knife/knife_gut/weapon_knife_gut',
	knife_karambit: 'knife/knife_karambit/weapon_knife_karambit',
	knife_kukri: 'knife/knife_kukri/weapon_knife_kukri',
	knife_m9: 'knife/knife_m9/weapon_knife_m9',
	knife_navaja: 'knife/knife_navaja/weapon_knife_navaja',
	knife_outdoor: 'knife/knife_outdoor/weapon_knife_outdoor',
	knife_push: 'knife/knife_push/weapon_knife_push',
	knife_skeleton: 'knife/knife_skeleton/weapon_knife_skeleton',
	knife_stiletto: 'knife/knife_stiletto/weapon_knife_stiletto',
	knife_tactical: 'knife/knife_tactical/weapon_knife_tactical',
	knife_talon: 'knife/knife_talon/weapon_knife_talon',
	knife_ursus: 'knife/knife_ursus/weapon_knife_ursus'
};

const WEAPON_SOUNDS: Record<string, [string, string | null]> = {
	ak47: ['Weapon_AK47.Single', 'Weapon_AK47.SingleDistant'],
	aug: ['Weapon_AUG.Single', 'Weapon_AUG.SingleDistant'],
	awp: ['Weapon_AWP.Single', 'Weapon_AWP.SingleDistant'],
	bizon: ['Weapon_bizon.Single', 'Weapon_bizon.SingleDistant'],
	cz75a: ['Weapon_CZ75A.Single', 'Weapon_CZ75A.SingleDistant'],
	deagle: ['Weapon_DEagle.Single', 'Weapon_DEagle.SingleDistant'],
	elite: ['Weapon_ELITE.Single', 'Weapon_ELITE.SingleDistant'],
	famas: ['Weapon_FAMAS.Single', 'Weapon_FAMAS.SingleDistant'],
	fiveseven: ['Weapon_FiveSeven.Single', 'Weapon_FiveSeven.SingleDistant'],
	g3sg1: ['Weapon_G3SG1.Single', 'Weapon_G3SG1.SingleDistant'],
	galilar: ['Weapon_GalilAR.Single', 'Weapon_GalilAR.SingleDistant'],
	glock: ['Weapon_Glock.Single', 'Weapon_Glock.SingleDistant'],
	hkp2000: ['Weapon_hkp2000.Single', 'Weapon_hkp2000.SingleDistant'],
	m249: ['Weapon_M249.Single', 'Weapon_M249.SingleDistant'],
	m4a1_silencer: ['Weapon_M4A1.Silenced', 'Weapon_M4A1.SingleDistant'],
	m4a4: ['Weapon_M4A4.Single', 'Weapon_M4A4.SingleDistant'],
	mac10: ['Weapon_MAC10.Single', 'Weapon_MAC10.SingleDistant'],
	mag7: ['Weapon_Mag7.Single', 'Weapon_Mag7.SingleDistant'],
	mp5sd: ['Weapon_MP5.Single', null],
	mp7: ['Weapon_MP7.Single', 'Weapon_MP7.SingleDistant'],
	mp9: ['Weapon_MP9.Single', 'Weapon_MP9.SingleDistant'],
	negev: ['Weapon_Negev.Single', 'Weapon_Negev.SingleDistant'],
	nova: ['Weapon_Nova.Single', 'Weapon_Nova.SingleDistant'],
	p250: ['Weapon_P250.Single', 'Weapon_P250.SingleDistant'],
	p90: ['Weapon_P90.Single', 'Weapon_P90.SingleDistant'],
	revolver: ['Weapon_Revolver.Single', 'Weapon_Revolver.SingleDistant'],
	sawedoff: ['Weapon_Sawedoff.Single', 'Weapon_Sawedoff.SingleDistant'],
	scar20: ['Weapon_SCAR20.Single', 'Weapon_SCAR20.SingleDistant'],
	sg556: ['Weapon_sg556.Single', 'Weapon_sg556.SingleDistant'],
	ssg08: ['Weapon_SSG08.Single', 'Weapon_SSG08.SingleDistant'],
	taser: ['Weapon_Taser.Single', null],
	tec9: ['Weapon_tec9.Single', 'Weapon_tec9.SingleDistant'],
	ump45: ['Weapon_UMP45.Single', 'Weapon_UMP45.SingleDistant'],
	usp_silencer: ['Weapon_USP.SilencedShot', null],
	xm1014: ['Weapon_XM1014.Single', 'Weapon_XM1014.SingleDistant']
};

const SOUNDS: Record<string, { event?: string; files?: string[]; loop?: boolean }> = {
	'step:CT': { event: 'CT_Concrete.StepLeft' },
	'step:T': { event: 'T_Concrete.StepLeft' },
	land: { event: 'Land_Concrete.StepLeft' },
	death: { event: 'Player.Death' },
	'kill:head': { event: 'Player.DeathHeadShot.Onlooker' },
	'kill:body': { event: 'Player.DeathBody.Onlooker' },
	flash: { event: 'Flashbang.Explode' },
	'flash:far': { event: 'Flashbang.ExplodeDistant' },
	he: { event: 'BaseGrenade.Explode' },
	'he:far': { event: 'BaseGrenade.ExplodeDistant' },
	smoke: { files: ['sounds/weapons/smokegrenade/smoke_emit.vsnd'] },
	molotov: {
		files: [1, 2, 3].map((n) => `sounds/weapons/molotov/molotov_detonate_${n}.vsnd`)
	},
	incendiary: {
		files: [1, 2, 3].map((n) => `sounds/weapons/incgrenade/inc_grenade_detonate_${n}.vsnd`)
	},
	fire: { files: ['sounds/weapons/molotov/fire_loop_1.vsnd'], loop: true },
	'bounce:he': { event: 'HEGrenade.Bounce' },
	'bounce:flash': { event: 'Flashbang.Bounce' },
	'bounce:smoke': { event: 'SmokeGrenade.Bounce' },
	'bounce:molotov': { event: 'Molotov.Bounce' },
	'bounce:decoy': { event: 'HEGrenade.Bounce' },
	'bomb:beep': { event: 'C4.PlantSound' },
	'bomb:plant': { event: 'c4.plant' },
	'bomb:defuse_start': { files: ['sounds/weapons/c4/c4_disarmstart.vsnd'] },
	'bomb:defused': { files: ['sounds/weapons/c4/c4_disarmfinish.vsnd'] },
	'bomb:explode': { event: 'c4.explode' }
};

const SOUND_SCRIPTS = [
	'soundevents/game_sounds_weapons.vsndevts_c',
	'soundevents/game_sounds_player.vsndevts_c',
	'soundevents/game_sounds_footsteps.vsndevts_c'
];

const DEFAULT_CURVE = [0, 1, 400, 0.6, 1500, 0.15, 3000, 0];

export const TEXTURE_PARAMS = new Set([
	'g_tColor',
	'g_tNormal',
	'g_tAmbientOcclusion',
	'g_tMetalness',
	'g_tTintMask',
	'g_tSelfIllumMask'
]);

const CHARACTER_TEXTURE_SIZE = 1024;
const WEAPON_TEXTURE_SIZE = 512;
const WEAPON_CONCURRENCY = 2;

function vrfModelArgs(vpk: string, model: string, gameinfo: string, outDir: string) {
	return [
		'-i',
		vpk,
		'-f',
		`${model}_c`,
		'-d',
		'--gltf_export_format',
		'gltf',
		'--gltf_export_materials',
		'--gltf_textures_adapt',
		'--game',
		gameinfo,
		'-o',
		outDir + sep
	];
}

export async function exportModel(
	tools: Tools,
	vpk: string,
	gameinfo: string,
	model: string,
	workDir: string,
	extra: string[],
	options: ModelGltfOptions,
	reuse = false
) {
	const glb = join(workDir, 'model.glb');
	const resultPath = join(workDir, 'result.json');
	const saved =
		reuse && existsSync(glb) && existsSync(resultPath)
			? (JSON.parse(await readFile(resultPath, 'utf8')) as {
					key?: string;
					textures: string[];
					materials?: string[];
					clips: string[];
					nodes: ModelResult['nodes'];
				})
			: null;
	const key = JSON.stringify([extra, options.dropSkins ?? false, options.weaponRigs ?? false]);
	if (saved && (saved.key ?? JSON.stringify([extra, false, false])) === key) {
		return {
			glb: await readFile(glb),
			textures: new Set(saved.textures),
			materials: saved.materials ?? [],
			clips: saved.clips,
			nodes: saved.nodes
		};
	}
	await rm(workDir, { recursive: true, force: true });
	await mkdir(workDir, { recursive: true });
	await run(tools.vrf, [...vrfModelArgs(vpk, model, gameinfo, workDir), ...extra]);
	const gltfPath = join(workDir, `${model.replace(/\.vmdl$/, '')}.gltf`);
	if (!existsSync(gltfPath)) throw new Error(`Source 2 Viewer wrote no ${gltfPath}`);
	const gltf = JSON.parse(await readFile(gltfPath, 'utf8')) as Gltf;
	const result = processModelGltf(gltf, options);
	const processed = join(dirname(gltfPath), 'processed.gltf');
	await writeFile(processed, JSON.stringify(gltf));
	await run(tools.gltfpack, [
		'-i',
		processed,
		'-o',
		glb,
		'-cc',
		'-kv',
		'-kn',
		'-km',
		'-ke',
		'-vtf'
	]);
	await writeFile(
		resultPath,
		JSON.stringify({
			key,
			textures: [...result.textures],
			materials: result.materials,
			clips: result.clips,
			nodes: result.nodes
		})
	);
	for (const entry of await readdir(workDir))
		if (entry !== 'model.glb' && entry !== 'result.json')
			await rm(join(workDir, entry), { recursive: true, force: true });
	return { glb: await readFile(glb), ...result };
}

async function exportViewmodel(
	tools: Tools,
	vpkPath: string,
	gameinfo: string,
	options: PlayerExportOptions,
	pack: PackBuilder,
	log: (message: string) => void
): Promise<PlayerPackViewmodel | undefined> {
	const groups = new Map<string, string[]>();
	for (const key of Object.keys(WEAPON_MODELS)) {
		const kind = weaponClass(key);
		const group = kind === 'c4' ? 'grenade' : kind;
		groups.set(group, [...(groups.get(group) ?? []), key]);
	}
	const animations: string[] = [];
	const clips = new Set<string>();
	for (const [group, keys] of groups) {
		const wanted = viewmodelClipNames(keys);
		log(`players: exporting ${wanted.length} first-person ${group} animations`);
		const exported = await exportModel(
			tools,
			vpkPath,
			gameinfo,
			CHARACTERS.CT,
			join(options.workDir, 'viewmodel', group),
			[
				'--gltf_export_animations',
				'--gltf_animation_list',
				wanted.join(','),
				'--gltf_mesh_list',
				CHARACTER_MESHES[0]!
			],
			{
				keepMeshes: false,
				skeletonRoot: SKELETON_ROOT,
				weaponRigs: true,
				animations: (name) => name.startsWith('animation/anims/viewmodel/'),
				textureParams: new Set()
			},
			options.reuseWork
		).catch((error: Error) => {
			log(`  ${group} first-person animations failed: ${error.message.split('\n')[0]}`);
			return null;
		});
		if (!exported?.clips.length) continue;
		const missing = wanted.filter((clip) => !exported.clips.includes(clip));
		if (missing.length) log(`  ${missing.length} missing: ${missing.join(', ')}`);
		for (const clip of exported.clips) clips.add(clip);
		animations.push(await pack.addFile(`viewmodel/${group}.glb`, exported.glb, true));
	}
	return animations.length ? { animations, clips: [...clips].sort() } : undefined;
}

async function exportSounds(
	vrf: Vrf,
	tools: Tools,
	vpkPath: string,
	workDir: string,
	pack: PackBuilder,
	log: (message: string) => void
): Promise<Record<string, PlayerPackSound>> {
	const scripts = [];
	for (const script of SOUND_SCRIPTS) {
		try {
			scripts.push(await vrf.dataBlock(vpkPath, script));
		} catch (error) {
			log(`  ${script} unreadable: ${(error as Error).message.split('\n')[0]}`);
		}
	}
	const events = collectSoundEvents(scripts);
	const wanted: Record<string, { event?: string; files?: string[]; loop?: boolean }> = {
		...SOUNDS
	};
	for (const [weapon, [near, far]] of Object.entries(WEAPON_SOUNDS)) {
		wanted[`shot:${weapon}`] = { event: near };
		if (far) wanted[`far:${weapon}`] = { event: far };
	}

	const resolved: Record<string, SoundEvent & { loop?: boolean }> = {};
	for (const [key, spec] of Object.entries(wanted)) {
		const event = spec.event ? resolveSoundEvent(events, spec.event) : null;
		const files = event?.files ?? spec.files;
		if (!files?.length) {
			log(`  no sound for ${key}`);
			continue;
		}
		resolved[key] = {
			files,
			volume: event?.volume ?? 1,
			pitch: event?.pitch ?? 1,
			curve: event?.curve.length ? event.curve : DEFAULT_CURVE,
			loop: spec.loop
		};
	}

	const files = [...new Set(Object.values(resolved).flatMap((sound) => sound.files))];
	const outDir = join(workDir, 'sounds');
	await mkdir(outDir, { recursive: true });
	for (let i = 0; i < files.length; i += 40) {
		const batch = files
			.slice(i, i + 40)
			.filter((file) => !existsSync(join(outDir, file.replace(/\.vsnd$/, '.wav'))));
		if (batch.length)
			await run(tools.vrf, [
				'-i',
				vpkPath,
				'-f',
				batch.map((file) => `${file}_c`).join(','),
				'-d',
				'-o',
				outDir + sep
			]);
	}

	const entries = new Map<string, string>();
	await forEachLimit(files, 4, async (file) => {
		const wav = join(outDir, file.replace(/\.vsnd$/, '.wav'));
		if (!existsSync(wav)) return;
		const name = file
			.replace(/^sounds\//, '')
			.replace(/\.vsnd$/, '')
			.replaceAll('/', '_');
		entries.set(file, await pack.addFile(`sounds/${name}.wav`, monoWav(await readFile(wav)), true));
	});

	const sounds: Record<string, PlayerPackSound> = {};
	for (const [key, sound] of Object.entries(resolved)) {
		const packed = sound.files.flatMap((file) => entries.get(file) ?? []);
		if (!packed.length) continue;
		sounds[key] = { ...sound, files: packed };
		if (!sound.loop) delete sounds[key]!.loop;
	}
	log(`players: ${Object.keys(sounds).length} sounds from ${entries.size} files`);
	return sounds;
}

export async function exportPlayers(
	options: PlayerExportOptions
): Promise<{ pack: string; bytes: number }> {
	const { csgo, log, tools } = options;
	const vpkPath = join(csgo, 'pak01_dir.vpk');
	const gameinfo = join(csgo, 'gameinfo.gi');
	await mkdir(options.outDir, { recursive: true });
	if (!options.reuseWork) await rm(options.workDir, { recursive: true, force: true });
	await mkdir(options.workDir, { recursive: true });
	const packPath = join(options.outDir, `${PLAYER_PACK_NAME}.zip`);
	const partPath = join(options.workDir, `${PLAYER_PACK_NAME}.zip`);

	const vpk = await Vpk.open(vpkPath);
	const pack = new PackBuilder(partPath, log, options.maxTextureSize ?? CHARACTER_TEXTURE_SIZE);
	const textures = new Set<string>();
	const weaponTextures = new Set<string>();

	try {
		const wanted = playerClipNames();
		log(`players: exporting ${wanted.length} animations`);
		const animations = await exportModel(
			tools,
			vpkPath,
			gameinfo,
			CHARACTERS.CT,
			join(options.workDir, 'animations'),
			[
				'--gltf_export_animations',
				'--gltf_compose_additive',
				'--gltf_animation_list',
				wanted.join(','),
				'--gltf_mesh_list',
				CHARACTER_MESHES[0]!
			],
			{
				keepMeshes: false,
				skeletonRoot: SKELETON_ROOT,
				animations: (name) => name.startsWith('animation/anims/world/'),
				textureParams: new Set()
			},
			options.reuseWork
		);
		const missing = wanted.filter((clip) => !animations.clips.includes(clip));
		if (missing.length) log(`players: ${missing.length} animations missing: ${missing.join(', ')}`);
		const animationFile = await pack.addFile('animations.glb', animations.glb, true);

		const characters = {} as Record<Side, string>;
		for (const side of ['CT', 'T'] as Side[]) {
			log(`players: exporting the ${side} model`);
			const model = await exportModel(
				tools,
				vpkPath,
				gameinfo,
				CHARACTERS[side],
				join(options.workDir, side),
				[
					'--gltf_export_animations',
					'--gltf_animation_list',
					'idle_rifle',
					'--gltf_mesh_list',
					CHARACTER_MESHES.join(',')
				],
				{
					skeletonRoot: SKELETON_ROOT,
					meshes: (name) => CHARACTER_MESHES.some((mesh) => name.endsWith(`.${mesh}`)),
					part: (name) => (name.includes('.firstperson_') ? 'firstperson' : null),
					textureParams: TEXTURE_PARAMS
				},
				options.reuseWork
			);
			for (const texture of model.textures) textures.add(texture);
			characters[side] = await pack.addFile(
				`characters/${side.toLowerCase()}.glb`,
				model.glb,
				true
			);
		}

		const weapons: Record<string, PlayerPackWeapon> = {};
		const available = Object.entries(WEAPON_MODELS).filter(([, path]) =>
			vpk.has(`weapons/models/${path}.vmdl_c`)
		);
		log(`players: exporting ${available.length} weapon models`);
		await forEachLimit(available, WEAPON_CONCURRENCY, async ([key, path]) => {
			const model = `weapons/models/${path}.vmdl`;
			const exported = await exportModel(
				tools,
				vpkPath,
				gameinfo,
				model,
				join(options.workDir, 'weapon-models', key),
				['--gltf_export_animations'],
				{
					meshes: (name) => !/\.(body_legacy|body_hidden)$/.test(name),
					textureParams: TEXTURE_PARAMS
				},
				options.reuseWork
			).catch((error: Error) => {
				log(`  ${key} failed: ${error.message.split('\n')[0]}`);
				return null;
			});
			if (!exported) return;
			for (const texture of exported.textures) weaponTextures.add(texture);
			const bone = exported.nodes[WEAPON_BONE];
			weapons[key] = {
				model: await pack.addFile(`weapons/${key}.glb`, exported.glb, true),
				translation: bone?.translation ?? [0, 0, 0],
				rotation: bone?.rotation ?? [0, 0, 0, 1]
			};
		});

		const viewmodel = await exportViewmodel(tools, vpkPath, gameinfo, options, pack, log);

		log('players: exporting sounds');
		const sounds = await exportSounds(
			new Vrf(tools.vrf, gameinfo),
			tools,
			vpkPath,
			options.workDir,
			pack,
			log
		);

		const weaponOnly = [...weaponTextures].filter((texture) => !textures.has(texture)).sort();
		log(`players: packing ${textures.size + weaponOnly.length} textures`);
		await forEachLimit([...textures].sort(), 4, (texture) => pack.addTexture(texture, [vpk]));
		await forEachLimit(weaponOnly, 4, (texture) =>
			pack.addTexture(
				texture,
				[vpk],
				'textures',
				Math.min(WEAPON_TEXTURE_SIZE, options.maxTextureSize || WEAPON_TEXTURE_SIZE)
			)
		);

		const manifest: PlayerPackManifest = {
			version: PLAYER_PACK_VERSION,
			exportedAt: new Date().toISOString(),
			build: gameBuild(csgo),
			tools: { ...tools.versions, exporter: EXPORTER_VERSION },
			characters,
			animations: animationFile,
			clips: animations.clips.sort(),
			weapons: Object.fromEntries(Object.entries(weapons).sort(([a], [b]) => a.localeCompare(b))),
			sounds,
			viewmodel,
			textures: pack.textures
		};
		await pack.addFile(
			PLAYER_PACK_MANIFEST,
			new TextEncoder().encode(JSON.stringify(manifest)),
			false
		);
		await pack.close();
		log(`Moving the pack to ${packPath}`);
		await mkdir(dirname(packPath), { recursive: true });
		await rename(partPath, packPath).catch(async (error: NodeJS.ErrnoException) => {
			if (error.code !== 'EXDEV') throw error;
			await copyFile(partPath, packPath);
		});
		return { pack: packPath, bytes: pack.bytes };
	} catch (error) {
		await pack.close().catch(() => {});
		throw error;
	} finally {
		await vpk.close();
		if (!options.keepWork && !options.reuseWork)
			await rm(options.workDir, { recursive: true, force: true });
	}
}
