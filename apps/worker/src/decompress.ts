import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import type { DemoFormat } from '@cs-demo-cloud/shared';
import unbzip2 from 'unbzip2-stream';

export interface DemoFile {
	path: string;
	cleanup: () => Promise<void>;
}

export async function openDemoFile(
	source: string,
	format: DemoFormat,
	workDir: string
): Promise<DemoFile> {
	if (format === 'dem') return { path: source, cleanup: async () => {} };

	await mkdir(workDir, { recursive: true });
	const target = join(workDir, `${randomUUID()}.dem`);
	const cleanup = () => rm(target, { force: true });
	try {
		if (format === 'bz2') await decompressBzip2(source, target);
		else {
			const decompress = format === 'gz' ? createGunzip() : createZstdDecompress();
			await pipeline(createReadStream(source), decompress, createWriteStream(target));
		}
	} catch (error) {
		await cleanup();
		throw error;
	}
	return { path: target, cleanup };
}

async function decompressBzip2(source: string, target: string): Promise<void> {
	try {
		await runToFile('bzip2', ['-dc', source], target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		await pipeline(createReadStream(source), unbzip2(), createWriteStream(target));
	}
}

function runToFile(command: string, args: string[], target: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const output = createWriteStream(target);
		let stderr = '';
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.stdout.pipe(output);
		child.on('close', (code) => {
			output.end(() => {
				if (code === 0) resolve();
				else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
			});
		});
	});
}
