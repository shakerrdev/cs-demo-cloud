import type { Demo } from '@cs-demo-cloud/db';

export async function processDemo(demo: Demo): Promise<void> {
	throw new Error(`Parsing is not implemented yet (${demo.fileName})`);
}
