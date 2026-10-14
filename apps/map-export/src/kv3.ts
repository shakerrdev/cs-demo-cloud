export type Kv3Value =
	string | number | boolean | null | Uint8Array | Kv3Value[] | { [key: string]: Kv3Value };

export type Kv3Object = { [key: string]: Kv3Value };

const NAME_CHAR = /[A-Za-z0-9_.:\-+]/;

export function parseKv3(text: string): Kv3Value {
	let i = 0;

	const fail = (message: string): never => {
		const line = text.slice(0, i).split('\n').length;
		throw new Error(`KV3 line ${line}: ${message}`);
	};

	const skip = () => {
		while (i < text.length) {
			const c = text[i]!;
			if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ',') i++;
			else if (text.startsWith('//', i)) {
				const end = text.indexOf('\n', i);
				i = end < 0 ? text.length : end + 1;
			} else if (text.startsWith('/*', i) || text.startsWith('<!--', i)) {
				const close = text.startsWith('/*', i) ? '*/' : '-->';
				const end = text.indexOf(close, i);
				if (end < 0) fail('unclosed comment');
				i = end + close.length;
			} else break;
		}
	};

	const readName = (): string => {
		if (text[i] === '"') return readString();
		const start = i;
		while (i < text.length && NAME_CHAR.test(text[i]!)) i++;
		if (start === i) fail(`unexpected ${JSON.stringify(text[i])}`);
		return text.slice(start, i);
	};

	const readString = (): string => {
		if (text.startsWith('"""', i)) {
			const end = text.indexOf('"""', i + 3);
			if (end < 0) fail('unclosed multiline string');
			const value = text
				.slice(i + 3, end)
				.replace(/^\r?\n/, '')
				.replace(/\r?\n$/, '');
			i = end + 3;
			return value;
		}
		i++;
		let value = '';
		while (i < text.length && text[i] !== '"') {
			if (text[i] === '\\' && i + 1 < text.length) {
				const next = text[i + 1]!;
				value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
				i += 2;
			} else value += text[i++];
		}
		if (text[i] !== '"') fail('unclosed string');
		i++;
		return value;
	};

	const readValue = (): Kv3Value => {
		skip();
		const c = text[i];
		if (c === undefined) fail('unexpected end');
		if (c === '{') {
			i++;
			const object: Kv3Object = {};
			for (skip(); text[i] !== '}'; skip()) {
				if (i >= text.length) fail('unclosed object');
				const key = readName();
				skip();
				if (text[i] !== '=') fail(`expected = after ${key}`);
				i++;
				object[key] = readValue();
			}
			i++;
			return object;
		}
		if (c === '[') {
			i++;
			const array: Kv3Value[] = [];
			for (skip(); text[i] !== ']'; skip()) {
				if (i >= text.length) fail('unclosed array');
				array.push(readValue());
			}
			i++;
			return array;
		}
		if (c === '#' && text[i + 1] === '[') {
			const end = text.indexOf(']', i);
			if (end < 0) fail('unclosed binary blob');
			const hex = text.slice(i + 2, end).match(/[0-9A-Fa-f]{2}/g) ?? [];
			i = end + 1;
			return Uint8Array.from(hex, (byte) => parseInt(byte, 16));
		}
		if (c === '"') return readString();

		const word = readName();
		if (text[i] === '"' || text.startsWith('"""', i)) return readString();
		if (word === 'true') return true;
		if (word === 'false') return false;
		if (word === 'null') return null;
		const number = Number(word);
		if (!Number.isNaN(number) || /^-?nan$/i.test(word)) return number;
		return word;
	};

	const value = readValue();
	skip();
	if (i < text.length) fail('trailing content');
	return value;
}

export function kv3Object(value: Kv3Value | undefined): Kv3Object | undefined {
	return value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		!(value instanceof Uint8Array)
		? value
		: undefined;
}

export function kv3Array(value: Kv3Value | undefined): Kv3Value[] {
	return Array.isArray(value) ? value : [];
}
