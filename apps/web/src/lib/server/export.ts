import type { DemoFormat } from '@cs-demo-cloud/shared';

export function exportFileName(fileName: string, format: DemoFormat, original: boolean): string {
	const base =
		fileName
			.replace(/^.*[\\/]/, '')
			.replace(/\.dem(\.(bz2|gz|zst))?$/i, '')
			.replace(/[\x00-\x1f"\\/:*?<>|]+/g, '_')
			.trim() || 'demo';
	return original && format !== 'dem' ? `${base}.dem.${format}` : `${base}.dem`;
}

export function attachment(fileName: string): string {
	const fallback = fileName.replace(/[^\x20-\x7e]/g, '_');
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
