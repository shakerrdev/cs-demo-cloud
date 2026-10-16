export type Kv1Value = string | Kv1Object;
export interface Kv1Object {
	[key: string]: Kv1Value;
}

export function parseKv1(text: string): Kv1Object {
	let i = 0;
	const token = (): string | null => {
		for (;;) {
			while (i < text.length && /\s/.test(text[i]!)) i++;
			if (text.startsWith('//', i)) {
				const end = text.indexOf('\n', i);
				i = end < 0 ? text.length : end;
				continue;
			}
			break;
		}
		if (i >= text.length) return null;
		const char = text[i]!;
		if (char === '{' || char === '}') {
			i++;
			return char;
		}
		if (char === '"') {
			let out = '';
			i++;
			while (i < text.length && text[i] !== '"') {
				if (text[i] === '\\' && i + 1 < text.length) {
					const next = text[i + 1]!;
					out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
					i += 2;
				} else out += text[i++];
			}
			i++;
			return out;
		}
		const start = i;
		while (i < text.length && !/[\s{}"]/.test(text[i]!)) i++;
		return text.slice(start, i);
	};

	const object = (): Kv1Object => {
		const out: Kv1Object = {};
		for (;;) {
			const key = token();
			if (key === null || key === '}') return out;
			const value = token();
			if (value === null) return out;
			const parsed = value === '{' ? object() : value;
			const existing = out[key];
			if (typeof existing === 'object' && typeof parsed === 'object')
				out[key] = { ...existing, ...parsed };
			else out[key] = parsed;
		}
	};
	return object();
}
