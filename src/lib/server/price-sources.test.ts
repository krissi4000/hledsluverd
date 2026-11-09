import { describe, expect, it } from 'vitest';
import { allScrapers } from './scrapers';
import { SCRAPER_SOURCE_URLS, priceSources } from './price-sources';
import networksSeed from '../../../seeds/networks.json';

describe('price sources', () => {
	it('has a source URL for exactly the registered scrapers', () => {
		expect(Object.keys(SCRAPER_SOURCE_URLS).sort()).toEqual(allScrapers.map((s) => s.id).sort());
	});

	it('marks seeded networks with a scraper as scraped, the rest manual (e1, Tesla)', () => {
		const nets = networksSeed.map((n) => ({
			name: n.name,
			slug: n.slug,
			websiteUrl: n.websiteUrl,
			scraperId: 'scraperId' in n ? (n.scraperId as string) : null
		}));
		const src = priceSources(nets);
		expect(src.filter((s) => s.method === 'scraped').map((s) => s.slug)).toEqual([
			'isorka',
			'n1',
			'on',
			'orkan'
		]);
		expect(src.filter((s) => s.method === 'manual').map((s) => s.slug)).toEqual(['e1', 'tesla']);
		expect(src.find((s) => s.slug === 'on')!.sourceUrl).toBe('https://www.on.is/verdskrar');
		expect(src.find((s) => s.slug === 'tesla')!.sourceUrl).toBeNull();
	});

	it('treats a scraper id with no registered module as manual', () => {
		const [s] = priceSources([{ name: 'X', slug: 'x', websiteUrl: null, scraperId: 'gone' }]);
		expect(s.method).toBe('manual');
	});
});
