import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
	it('transliterates Icelandic characters', () => {
		expect(slugify('Hellisheiði')).toBe('hellisheidi');
		expect(slugify('Þórshöfn')).toBe('thorshofn');
		expect(slugify('Ártúnshöfði')).toBe('artunshofdi');
		expect(slugify('Æsuvellir')).toBe('aesuvellir');
	});
	it('collapses non-alphanumerics into single dashes and trims them', () => {
		expect(slugify('Olís – Norðlingaholt (v/Austurveg)')).toBe('olis-nordlingaholt-v-austurveg');
	});
	it('handles uppercase Icelandic letters', () => {
		expect(slugify('ÐÆÖÁ')).toBe('daeoa');
	});
});
