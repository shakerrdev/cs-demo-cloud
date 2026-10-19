import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import unbzip2 from 'unbzip2-stream';
import type { DemoFormat } from './storage.ts';

let nativeBzip2: boolean | undefined;

function hasNativeBzip2(): boolean {
	nativeBzip2 ??= !spawnSync('bzip2', ['-h'], { stdio: 'ignore' }).error;
	return nativeBzip2;
}

export function demoStream(source: string, format: DemoFormat): Readable {
	if (format === 'dem') return createReadStream(source);
	if (format === 'bz2' && hasNativeBzip2()) return spawnBzip2(source);
	const decompress =
		format === 'bz2' ? unbzip2() : format === 'gz' ? createGunzip() : createZstdDecompress();
	const out = new PassThrough();
	pipeline(createReadStream(source), decompress, out).catch((error: Error) => out.destroy(error));
	return out;
}

function spawnBzip2(source: string): Readable {
	const child = spawn('bzip2', ['-dc', source], { stdio: ['ignore', 'pipe', 'pipe'] });
	const out = new PassThrough();
	let stderr = '';
	child.stderr.on('data', (chunk) => (stderr += chunk));
	child.stdout.pipe(out, { end: false });
	child.on('error', (error) => out.destroy(error));
	child.on('close', (code) => {
		if (code === 0) out.end();
		else out.destroy(new Error(`bzip2 exited with ${code}: ${stderr.trim()}`));
	});
	out.on('close', () => {
		if (child.exitCode === null) child.kill();
	});
	return out;
}
