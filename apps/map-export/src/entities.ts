import type { Vec3 } from '@cs-demo-cloud/replay';

export type Entity = Map<string, string>;

export function parseEntities(text: string): Entity[] {
	const entities: Entity[] = [];
	let current: Entity | null = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (/^====\d+====$/.test(line)) {
			current = new Map();
			entities.push(current);
			continue;
		}
		if (!current) continue;
		const match = /^(\S+)\s+(.*)$/.exec(line);
		if (match) current.set(match[1]!.toLowerCase(), match[2]!.trim());
	}
	return entities;
}

function unquote(value: string): string {
	const prefixed = /^[a-z_]+:"(.*)"$/i.exec(value);
	if (prefixed) return prefixed[1]!;
	if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
	return value;
}

export function text(entity: Entity, key: string): string | undefined {
	const value = entity.get(key);
	return value === undefined
		? undefined
		: unquote(value)
				.replace(/^\[PR#\]/, '')
				.replace(/\\+/g, '/');
}

export function numbers(entity: Entity, key: string): number[] | undefined {
	const value = entity.get(key);
	if (value === undefined) return undefined;
	const parts = unquote(value)
		.replace(/[[\],]/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map(Number);
	return parts.length && parts.every(Number.isFinite) ? parts : undefined;
}

export function number(entity: Entity, key: string, fallback: number): number {
	const value = numbers(entity, key)?.[0];
	if (value !== undefined) return value;
	const raw = text(entity, key);
	if (raw === 'true') return 1;
	if (raw === 'false') return 0;
	return fallback;
}

export function vec3(entity: Entity, key: string, fallback: Vec3): Vec3 {
	const value = numbers(entity, key);
	return value && value.length >= 3 ? [value[0]!, value[1]!, value[2]!] : fallback;
}

export function className(entity: Entity): string {
	return text(entity, 'classname') ?? '';
}

export function findClass(entities: Entity[], name: string): Entity | undefined {
	return entities.find((entity) => className(entity) === name);
}
