import { spawn } from 'node:child_process';
import { parseKv3, type Kv3Value } from './kv3.ts';

export function run(
	command: string,
	args: string[],
	options: { quiet?: boolean; maxOutput?: number } = {}
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		let size = 0;
		const limit = options.maxOutput ?? 64 * 1024 * 1024;
		child.stdout.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size <= limit) out.push(chunk);
		});
		child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
		child.on('error', reject);
		child.on('close', (code, signal) => {
			const stdout = Buffer.concat(out).toString('utf8');
			if (code === 0) resolve(stdout);
			else {
				const stderr = Buffer.concat(err).toString('utf8').trim();
				const tail = (stderr || stdout).split('\n').slice(-6).join('\n');
				const reason = signal
					? `was stopped (${signal}, often too little memory)`
					: `exited with ${code}`;
				reject(new Error(`${command} ${reason}\n${tail}`));
			}
		});
	});
}

const DATA_MARKER = '--- Data for block "DATA" ---';

export function splitDataBlocks(output: string): Map<string, string> {
	const blocks = new Map<string, string>();
	const headers = [...output.matchAll(/^\[\d+\/\d+\] (.+?)\s*$/gm)];
	headers.forEach((header, i) => {
		const end = headers[i + 1]?.index ?? output.length;
		const section = output.slice(header.index!, end);
		const start = section.indexOf(DATA_MARKER);
		if (start >= 0) blocks.set(header[1]!, section.slice(start + DATA_MARKER.length).trim());
	});
	return blocks;
}

export class Vrf {
	private cli: string;
	private gameinfo: string;

	constructor(cli: string, gameinfo: string) {
		this.cli = cli;
		this.gameinfo = gameinfo;
	}

	async dataBlock(vpk: string, path: string): Promise<Kv3Value> {
		const output = await run(this.cli, ['-i', vpk, '-f', path, '-b', 'DATA']);
		const start = output.indexOf(DATA_MARKER);
		if (start < 0) throw new Error(`No DATA block printed for ${path}`);
		return parseKv3(output.slice(start + DATA_MARKER.length).trim());
	}

	async dataBlocks(vpk: string, paths: string[]): Promise<Map<string, Kv3Value>> {
		const output = await run(this.cli, ['-i', vpk, '-f', paths.join(','), '-b', 'DATA'], {
			maxOutput: 512 * 1024 * 1024
		});
		const parsed = new Map<string, Kv3Value>();
		for (const [path, text] of splitDataBlocks(output)) {
			try {
				parsed.set(path, parseKv3(text));
			} catch {}
		}
		return parsed;
	}

	async decompile(vpk: string, filter: string, outDir: string, extensions?: string) {
		const args = ['-i', vpk, '-f', filter, '-d', '-o', outDir];
		if (extensions) args.push('-e', extensions);
		await run(this.cli, args);
	}

	async exportGltf(vpk: string, world: string, outDir: string) {
		await run(this.cli, [
			'-i',
			vpk,
			'-f',
			world,
			'-d',
			'--gltf_export_format',
			'gltf',
			'--gltf_export_materials',
			'--gltf_textures_adapt',
			'--gltf_export_extras',
			'--game',
			this.gameinfo,
			'-o',
			outDir
		]);
	}
}
