import { existsSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { openZipFile } from '@cs-demo-cloud/shared/zip';

export const VRF_VERSION = '20.0';
export const GLTFPACK_VERSION = '1.3';

export interface Tools {
	vrf: string;
	gltfpack: string;
	versions: Record<string, string>;
}

interface Platform {
	vrfAsset: string;
	gltfpackAsset: string | null;
	exe: string;
}

function platform(): Platform {
	const key = `${process.platform}-${process.arch}`;
	switch (key) {
		case 'win32-x64':
			return {
				vrfAsset: 'cli-windows-x64.zip',
				gltfpackAsset: 'gltfpack-windows.zip',
				exe: '.exe'
			};
		case 'win32-arm64':
			return { vrfAsset: 'cli-windows-arm64.zip', gltfpackAsset: null, exe: '.exe' };
		case 'linux-x64':
			return { vrfAsset: 'cli-linux-x64.zip', gltfpackAsset: 'gltfpack-ubuntu.zip', exe: '' };
		case 'linux-arm64':
			return { vrfAsset: 'cli-linux-arm64.zip', gltfpackAsset: null, exe: '' };
		case 'darwin-arm64':
			return { vrfAsset: 'cli-macos-arm64.zip', gltfpackAsset: 'gltfpack-macos.zip', exe: '' };
		case 'darwin-x64':
			return { vrfAsset: 'cli-macos-x64.zip', gltfpackAsset: 'gltfpack-macos.zip', exe: '' };
		default:
			throw new Error(`No Source 2 Viewer build for ${key}`);
	}
}

export function defaultToolsDir(): string {
	if (process.platform === 'win32' && process.env.LOCALAPPDATA)
		return join(process.env.LOCALAPPDATA, 'cs-demo-cloud', 'tools');
	return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'cs-demo-cloud', 'tools');
}

async function download(url: string, target: string, log: (message: string) => void) {
	log(`Downloading ${basename(url)}…`);
	const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
	if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(`${target}.part`, new Uint8Array(await response.arrayBuffer()));
	await rename(`${target}.part`, target);
}

async function unzip(archive: string, folder: string) {
	const zip = await openZipFile(archive);
	try {
		for (const entry of zip.entries.values()) {
			if (entry.name.endsWith('/')) continue;
			const target = join(folder, ...entry.name.split('/').filter((part) => part && part !== '..'));
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, await zip.read(entry));
			if (process.platform !== 'win32') await chmod(target, 0o755);
		}
	} finally {
		await zip.close();
	}
}

async function ensureTool(
	folder: string,
	executable: string,
	url: string,
	log: (message: string) => void
): Promise<string> {
	const path = join(folder, executable);
	if (existsSync(path)) return path;
	const archive = join(folder, basename(url));
	await download(url, archive, log);
	await unzip(archive, folder);
	await rm(archive);
	if (!existsSync(path)) throw new Error(`${basename(url)} did not contain ${executable}`);
	return path;
}

export async function ensureTools(
	toolsDir: string,
	log: (message: string) => void
): Promise<Tools> {
	const target = platform();
	const vrf =
		process.env.VRF_CLI ??
		(await ensureTool(
			join(toolsDir, `vrf-${VRF_VERSION}`),
			`Source2Viewer-CLI${target.exe}`,
			`https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_VERSION}/${target.vrfAsset}`,
			log
		));

	let gltfpack = process.env.GLTFPACK;
	if (!gltfpack) {
		if (!target.gltfpackAsset)
			throw new Error('gltfpack has no build for this system; install it and set GLTFPACK');
		gltfpack = await ensureTool(
			join(toolsDir, `gltfpack-${GLTFPACK_VERSION}`),
			`gltfpack${target.exe}`,
			`https://github.com/zeux/meshoptimizer/releases/download/v${GLTFPACK_VERSION}/${target.gltfpackAsset}`,
			log
		);
	}

	return { vrf, gltfpack, versions: { vrf: VRF_VERSION, gltfpack: GLTFPACK_VERSION } };
}
