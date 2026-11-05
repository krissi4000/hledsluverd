import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	extractActionId,
	matchN1Location,
	parseN1ActionResponse,
	parseN1ListPrice,
	parseN1Locations
} from './n1';

const fx = (name: string) =>
	readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url), 'utf8');

// /is/eldsneytisverd, 2026-11: initialItems (default station card) + listPriceItems + locations
const PAGE_2026_11 = 'n1-eldsneytisverd-2026-11.txt';

describe('N1 parsers', () => {
	it('finds the Rafmagn list price in the escaped HTML blob', () => {
		expect(parseN1ListPrice(fx('n1-blob.txt'))).toBe(56);
	});

	it('returns null when Listaverð has no Rafmagn row', () => {
		expect(parseN1ListPrice(fx('n1-blob.txt').replace(/Rafmagn/g, 'Vetni'))).toBeNull();
	});

	it('2026-11 page: no list price, and never the default station card as one', () => {
		const page = fx(PAGE_2026_11);
		expect(page).toContain('\\"initialItems\\"'); // the card that does carry Rafmagn 50
		expect(page).toMatch(/\\"title\\":\\"Rafmagn\\"/);
		expect(parseN1ListPrice(page)).toBeNull();
	});

	it('throws when the Listaverð block is gone (fail loud)', () => {
		expect(() => parseN1ListPrice(fx('n1-blob.txt').replace('listPriceItems', 'x'))).toThrow(
			/N1 parse failed/
		);
	});

	it('throws on a Rafmagn list row priced in another unit', () => {
		expect(() => parseN1ListPrice(fx('n1-blob.txt').replace('kr./kWh', 'kr./mín'))).toThrow(
			/unexpected Rafmagn list row/
		);
	});

	it('reads the station picker locations', () => {
		const locs = parseN1Locations(fx(PAGE_2026_11));
		expect(locs).toHaveLength(97);
		expect(locs).toContainEqual({
			value: '4931_service',
			label: 'N1 Blönduós - Norðurlandsvegur 3 - 540 Blönduós'
		});
	});

	it('reads the per-station Rafmagn price from an action response', () => {
		expect(parseN1ActionResponse(fx('n1-action-response.txt'))).toBe(50);
	});

	it('returns null when a station publishes no Rafmagn price', () => {
		const noEv = fx('n1-action-response.txt').replace('"title":"Rafmagn"', '"title":"Rafmagn2"');
		expect(parseN1ActionResponse(noEv)).toBeNull();
	});

	it('throws on an unexpected action-response shape', () => {
		expect(() => parseN1ActionResponse('0:{}\n')).toThrow(/N1 action response/);
		expect(() => parseN1ActionResponse('1:{"success":false}\n')).toThrow(/N1 action response/);
	});

	it('extracts the server-action id from a JS chunk', () => {
		expect(extractActionId(fx('n1-chunk-snippet.js.txt'))).toBe(
			'4051f8163eecdb5165ae60c3c94541d4e3cb624d2b'
		);
		expect(extractActionId('var x = 1;')).toBeNull();
	});
});

describe('matchN1Location', () => {
	const locs = parseN1Locations(fx(PAGE_2026_11));
	const match = (name: string, address: string | null) => {
		const m = matchN1Location({ name, address }, locs);
		return m.kind === 'match' ? m.location.value : m.kind;
	};

	// our OCM-seeded N1 stations as of 2026-11-05 (prod), with the picker id they belong to
	it.each([
		['Dalvík (N1)', 'Hafnarbraut 22, Dalvík', '5620_self'],
		['Sauðárkrókur (N1)', 'Ártorg 4, Sauðárkróki', '5110_service'],
		[
			'Kirkjubæjarklaustur (N1)',
			'Kirkjubæjarklaustur(N1), Klausturvegur 29, Kirkjubæjarklaustri',
			'8055_self'
		],
		['Vík í Mýrdal (N1)', 'Austurvegur 18, Vík', '8035_self'],
		['Ísafjörður (N1)', 'Hafnarstræti 21, Ísafirði', '4120_service'],
		['N1 Ísafirði', 'Hafnarstræti 21, Ísafjörður', '4120_service'],
		['Blönduós (N1)', 'Blöndós (N1), Norðurlandsvegur 3, Blönduósi', '4931_service'],
		['Egilsstaðir (N1)', 'Egilsstaðir(N1), Kaupvangur 4, Egilsstöðum', '7170_service'],
		['Staðarskáli (N1)', 'Staðarskáli , Stað', '4860_service'],
		['Hvolsvöllur (N1)', 'Hvolsvöllur(N1), Austurvegur 3, Hvolsvelli', '8210_service'],
		['N1', 'Skógarlind, Kópavogur', '410_self']
	])('%s → %s', (name, address, id) => {
		expect(match(name, address)).toBe(id);
	});

	it('reports ambiguity instead of picking', () => {
		// "Austurvegur" alone hits Selfoss, Vík and Hvolsvöllur
		expect(match('Austurvegur (N1)', null)).toBe('ambiguous');
	});

	it('never matches on a town word alone', () => {
		expect(match('N1', 'Kópavogur')).toBe('unmatched');
		expect(match('Hleðslustöð', 'Engin gata')).toBe('unmatched');
	});
});
