const MAP: Record<string, string> = {
	á: 'a',
	é: 'e',
	í: 'i',
	ó: 'o',
	ú: 'u',
	ý: 'y',
	ð: 'd',
	þ: 'th',
	æ: 'ae',
	ö: 'o'
};

export function slugify(input: string): string {
	return input
		.toLowerCase()
		.split('')
		.map((c) => MAP[c] ?? c)
		.join('')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
