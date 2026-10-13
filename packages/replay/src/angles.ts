const YAW_UNITS = 65536;

export function packYaw(degrees: number): number {
	return Math.round((degrees / 360) * YAW_UNITS) & 0xffff;
}

export function unpackYaw(packed: number): number {
	return (packed * 360) / YAW_UNITS;
}

export function packPitch(degrees: number): number {
	return Math.round(degrees * 100);
}

export function unpackPitch(packed: number): number {
	return packed / 100;
}

export function lerpAngle(from: number, to: number, t: number): number {
	const delta = ((((to - from) % 360) + 540) % 360) - 180;
	return from + delta * t;
}
