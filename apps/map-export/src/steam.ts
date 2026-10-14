import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const CS2_FOLDER = join('steamapps', 'common', 'Counter-Strike Global Offensive');

function csgoIn(folder: string): string | null {
	for (const candidate of [
		folder,
		join(folder, 'csgo'),
		join(folder, 'game', 'csgo'),
		join(folder, CS2_FOLDER, 'game', 'csgo')
	]) {
		if (existsSync(join(candidate, 'gameinfo.gi')) && existsSync(join(candidate, 'pak01_dir.vpk')))
			return resolve(candidate);
	}
	return null;
}

export function libraryFolders(vdf: string): string[] {
	return [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((match) => match[1]!.replace(/\\\\/g, '\\'));
}

function steamRoots(): string[] {
	const roots: string[] = [];
	if (process.platform === 'win32') {
		try {
			const output = execFileSync(
				'reg',
				['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
				{
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'ignore']
				}
			);
			const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(output);
			if (match) roots.push(match[1]!.trim());
		} catch {}
		roots.push(join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'));
	} else if (process.platform === 'darwin') {
		roots.push(join(homedir(), 'Library', 'Application Support', 'Steam'));
	} else {
		roots.push(
			join(homedir(), '.steam', 'steam'),
			join(homedir(), '.local', 'share', 'Steam'),
			join(homedir(), '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam')
		);
	}
	return roots;
}

export function findCsgo(explicit?: string): string {
	if (explicit) {
		const found = csgoIn(explicit);
		if (!found) throw new Error(`No CS2 install (game/csgo/gameinfo.gi) found in ${explicit}`);
		return found;
	}

	for (const root of steamRoots()) {
		const libraries = [root];
		const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
		if (existsSync(vdf)) libraries.push(...libraryFolders(readFileSync(vdf, 'utf8')));
		for (const library of libraries) {
			const found = csgoIn(join(library, CS2_FOLDER, 'game', 'csgo'));
			if (found) return found;
		}
	}
	throw new Error('CS2 was not found. Pass its folder with --game <path>');
}

export function gameBuild(csgo: string): string | null {
	const inf = join(csgo, 'steam.inf');
	if (!existsSync(inf)) return null;
	const match = /^PatchVersion=(.+)$/m.exec(readFileSync(inf, 'utf8'));
	return match ? match[1]!.trim() : null;
}
