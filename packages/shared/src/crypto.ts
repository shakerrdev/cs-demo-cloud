import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 32;
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLEL = 1;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			password.normalize('NFKC'),
			salt,
			KEY_LENGTH,
			{ ...options, maxmem: 128 * 1024 * 1024 },
			(error, key) => (error ? reject(error) : resolve(key))
		);
	});
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await derive(password, salt, { N: COST, r: BLOCK_SIZE, p: PARALLEL });
	return [
		'scrypt',
		COST,
		BLOCK_SIZE,
		PARALLEL,
		salt.toString('base64'),
		key.toString('base64')
	].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, cost, blockSize, parallel, salt, hash] = stored.split('$');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	const key = await derive(password, Buffer.from(salt, 'base64'), {
		N: Number(cost),
		r: Number(blockSize),
		p: Number(parallel)
	});
	return key.length === expected.length && timingSafeEqual(key, expected);
}

export function createToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
