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
