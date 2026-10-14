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

export class Vrf {
	private cli: string;
	private gameinfo: string;

	constructor(cli: string, gameinfo: string) {
		this.cli = cli;
		this.gameinfo = gameinfo;
	}

	async dataBlock(vpk: string, path: string): Promise<Kv3Value> {
		const output = await run(this.cli, ['-i', vpk, '-f', path, '-b', 'DATA']);
		const marker = '--- Data for block "DATA" ---';
		const start = output.indexOf(marker);
		if (start < 0) throw new Error(`No DATA block printed for ${path}`);
		return parseKv3(output.slice(start + marker.length).trim());
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
			'--game',
			this.gameinfo,
			'-o',
			outDir
		]);
	}
}
