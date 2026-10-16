import type { SessionUser } from '@cs-demo-cloud/db';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			apiToken: boolean;
		}
	}
}

export {};
