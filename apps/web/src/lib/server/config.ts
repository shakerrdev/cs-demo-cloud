import { getAppConfigJson } from '@cs-demo-cloud/db';
import { normalizeConfig, type AppConfig } from '@cs-demo-cloud/replay';
import { db } from './db.ts';

export function loadConfig(): AppConfig {
	return normalizeConfig(getAppConfigJson(db));
}
