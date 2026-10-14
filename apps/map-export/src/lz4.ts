export function decodeLz4Block(input: Uint8Array, output: Uint8Array): number {
	let i = 0;
	let o = 0;
	while (i < input.length) {
		const token = input[i++]!;

		let literals = token >> 4;
		if (literals === 15) {
			let byte: number;
			do {
				byte = input[i++]!;
				literals += byte;
			} while (byte === 255 && i < input.length);
		}
		if (i + literals > input.length || o + literals > output.length)
			throw new Error('LZ4 literals run past the end');
		output.set(input.subarray(i, i + literals), o);
		i += literals;
		o += literals;
		if (i >= input.length) break;

		const offset = input[i]! | (input[i + 1]! << 8);
		i += 2;
		let length = token & 15;
		if (length === 15) {
			let byte: number;
			do {
				byte = input[i++]!;
				length += byte;
			} while (byte === 255 && i < input.length);
		}
		length += 4;

		const from = o - offset;
		if (offset === 0 || from < 0) throw new Error('LZ4 match points before the start');
		if (o + length > output.length) throw new Error('LZ4 match runs past the end');
		if (offset >= length) {
			output.copyWithin(o, from, from + length);
		} else {
			for (let k = 0; k < length; k++) output[o + k] = output[from + k]!;
		}
		o += length;
	}
	return o;
}
