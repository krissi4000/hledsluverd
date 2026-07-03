export function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

export function formatIsk(value: number): string {
	return `${formatNumber(value)} kr`;
}

export function formatDate(d: Date): string {
	return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}
