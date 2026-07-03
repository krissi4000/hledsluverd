import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOcm, type NetworkMatcher } from './ocm';

const pois = JSON.parse(readFileSync('tests/fixtures/ocm-sample.json', 'utf8'));
const matchers: NetworkMatcher[] = [
	{ slug: 'on', ocmOperatorIds: [102], ocmMatchers: ['orka náttúrunnar', 'on power'] },
	{ slug: 'isorka', ocmOperatorIds: [], ocmMatchers: ['ísorka', 'isorka'] }
];

describe('parseOcm', () => {
	it('maps matched operators to network slugs and extracts location', () => {
		const { drafts } = parseOcm(pois, matchers);
		expect(drafts).toHaveLength(2);
		const on = drafts.find((d) => d.networkSlug === 'on')!;
		expect(on.name).toBe('Hellisheiði');
		expect(on.address).toBe('Hellisheiðarvirkjun, Ölfus');
		expect(on.lat).toBeCloseTo(64.0374);
		expect(on.lng).toBeCloseTo(-21.4009);
		expect(on.ocmId).toBe(111001);
	});

	it('matches by operator ID even when no title matcher would hit', () => {
		const { drafts } = parseOcm(pois, [{ slug: 'on', ocmOperatorIds: [102], ocmMatchers: [] }]);
		expect(drafts.map((d) => d.networkSlug)).toEqual(['on']);
	});

	it('matches unattributed POIs by station title and reports them per station', () => {
		const withN1 = [...matchers, { slug: 'n1', ocmOperatorIds: [], ocmMatchers: ['n1'] }];
		const { drafts, titleMatched } = parseOcm(pois, withN1);
		const n1 = drafts.find((d) => d.networkSlug === 'n1')!;
		expect(n1.ocmId).toBe(111004);
		expect(titleMatched).toEqual([{ station: 'Staðarskáli (N1)', ocmId: 111004, slug: 'n1' }]);
	});

	it('drops exact re-import duplicates, keeping the newest POI', () => {
		// 111000 and 111004 share network, title and coordinates — OCM bulk-import copies
		const withN1 = [...matchers, { slug: 'n1', ocmOperatorIds: [], ocmMatchers: ['n1'] }];
		const { drafts, duplicates } = parseOcm(pois, withN1);
		expect(drafts.filter((d) => d.networkSlug === 'n1')).toHaveLength(1);
		expect(duplicates).toEqual([
			{ station: 'Staðarskáli (N1)', slug: 'n1', keptOcmId: 111004, droppedOcmIds: [111000] }
		]);
	});

	it('never station-title matches a POI attributed to a real third-party operator', () => {
		const attributed = { ...pois[3], OperatorInfo: { ID: 3708, Title: 'Orkubú Vestfjarða' } };
		const { drafts, skipped } = parseOcm(
			[attributed],
			[{ slug: 'n1', ocmOperatorIds: [], ocmMatchers: ['n1'] }]
		);
		expect(drafts).toHaveLength(0);
		expect(skipped).toEqual([{ operator: 'Orkubú Vestfjarða', count: 1 }]);
	});

	it('falls back to title matching on Unicode word boundaries only', () => {
		// contains the substring 'on' but not the word 'on' — must NOT match
		const decoy = { ...pois[2], OperatorInfo: { ID: 9999, Title: 'Onion Hotels' } };
		const { drafts, skipped } = parseOcm(
			[decoy],
			[{ slug: 'on', ocmOperatorIds: [], ocmMatchers: ['on'] }]
		);
		expect(drafts).toHaveLength(0);
		expect(skipped).toEqual([{ operator: 'Onion Hotels', count: 1 }]);
	});

	it('reports matched operator → slug pairs for review', () => {
		const { matched } = parseOcm(pois, matchers);
		expect(matched).toEqual(
			expect.arrayContaining([
				{ operator: 'Orka Náttúrunnar', operatorId: 102, slug: 'on', via: 'id' },
				{ operator: 'Ísorka', operatorId: 3400, slug: 'isorka', via: 'title' }
			])
		);
	});

	it('aggregates connections by (type, power), defaulting quantity to 1', () => {
		const { drafts } = parseOcm(pois, matchers);
		const on = drafts.find((d) => d.networkSlug === 'on')!;
		expect(on.connectors).toEqual(
			expect.arrayContaining([
				{ type: 'CCS2', powerKw: 150, count: 2 },
				{ type: 'CHAdeMO', powerKw: 50, count: 1 },
				{ type: 'Type2', powerKw: 22, count: 1 }
			])
		);
		const isorka = drafts.find((d) => d.networkSlug === 'isorka')!;
		// two Type2 entries (socket 25 + tethered 1036) at same power merge: 2 + 2 = 4
		expect(isorka.connectors).toEqual([{ type: 'Type2', powerKw: 22, count: 4 }]);
	});

	it('skips unmatched operators and reports them', () => {
		// 111003: generic operator, unbranded title; 111004/111000: no operator, no N1 matcher here
		const { skipped } = parseOcm(pois, matchers);
		expect(skipped).toEqual([
			{ operator: 'Some Hotel Chain', count: 1 },
			{ operator: '(no operator)', count: 2 }
		]);
	});
});
