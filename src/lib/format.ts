export function formatIsk(value: number): string {
	const s = Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
	return `${s} kr`;
}

export function formatDate(d: Date): string {
	return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}
