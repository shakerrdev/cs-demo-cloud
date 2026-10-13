import { createStorage } from '@cs-demo-cloud/shared';

export const storage = createStorage();

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isDemoId(value: string): boolean {
	return uuid.test(value);
}
