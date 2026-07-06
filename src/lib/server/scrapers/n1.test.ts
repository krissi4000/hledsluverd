import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractActionId, parseN1ActionResponse, parseN1ListPrice } from './n1';

const fx = (name: string) =>
	readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url), 'utf8');

describe('N1 parsers', () => {
	it('finds the Rafmagn list price in the escaped HTML blob', () => {
		expect(parseN1ListPrice(fx('n1-blob.txt'))).toBe(56);
	});

	it('throws when Rafmagn is missing from the blob (fail loud)', () => {
		expect(() => parseN1ListPrice(fx('n1-blob.txt').replace(/Rafmagn/g, 'Vetni'))).toThrow(
			/N1 parse failed/
		);
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
