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

const roundEndReasons: Record<string, string> = {
	bomb_exploded: 'Bomb exploded',
	bomb_defused: 'Bomb defused',
	t_killed: 'Terrorists eliminated',
	ct_killed: 'CTs eliminated',
	target_saved: 'Time ran out',
	t_surrender: 'Terrorists surrendered',
	ct_surrender: 'CTs surrendered'
};

export function roundEndReason(reason: string | null): string {
	return reason ? (roundEndReasons[reason] ?? reason.replace(/_/g, ' ')) : '';
}

export function placeName(place: string): string {
	return place
		.replace(/([a-z])of([A-Z])/g, '$1 of $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}
