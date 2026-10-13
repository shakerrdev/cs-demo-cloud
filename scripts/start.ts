import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const root = join(import.meta.dirname, '..');

if (!existsSync(join(root, 'apps/web/build/handler.js'))) {
	console.error('The web app is not built yet. Run `pnpm build` first.');
	process.exit(1);
}

process.env.BODY_SIZE_LIMIT ||= 'Infinity';
process.env.PORT ||= '3000';

function run(name: string, script: string): ChildProcess {
	const child = spawn(process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
	for (const stream of [child.stdout!, child.stderr!]) {
		createInterface({ input: stream }).on('line', (line) => console.log(`[${name}] ${line}`));
	}
	return child;
}

const [migrated] = await once(run('migrate', 'packages/db/src/migrate.ts'), 'exit');
if (migrated !== 0) process.exit(1);

const children = [run('web', 'apps/web/server.js'), run('worker', 'apps/worker/src/index.ts')];
let stopping = false;

function stop(code: number) {
	if (stopping) return;
	stopping = true;
	process.exitCode = code;
	for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}

for (const child of children) child.on('exit', (code) => stop(code || 1));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop(0));
