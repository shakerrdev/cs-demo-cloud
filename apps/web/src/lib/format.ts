const sizeUnits = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(bytes: number): string {
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < sizeUnits.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(unit === 0 ? 0 : 1)} ${sizeUnits[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short'
});

export function formatDate(date: Date): string {
	return dateFormat.format(date);
}

export function formatDuration(seconds: number): string {
	const minutes = Math.round(seconds / 60);
	return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export function formatClock(seconds: number): string {
	const total = Math.max(0, Math.ceil(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const platformNames = { valve: 'Valve', faceit: 'FACEIT', other: 'Other' } as const;

export function platformName(platform: keyof typeof platformNames): string {
	return platformNames[platform];
}
