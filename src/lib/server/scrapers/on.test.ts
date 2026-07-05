import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOnVerdskra } from './on';

const html = readFileSync(
	new URL('../../../../tests/fixtures/on-verdskrar.html', import.meta.url),
	'utf8'
);

describe('parseOnVerdskra', () => {
	it('extracts Ferðahleðsla AC and Hraðhleðsla DC from the rendered text, not the stale attrs', () => {
		const readings = parseOnVerdskra(html);
		expect(readings).toEqual([
			{ tariffKey: 'AC', priceIskPerKwh: 48, minuteFeeIsk: 0.5, minuteFeeAfterMin: null },
			{ tariffKey: 'DC', priceIskPerKwh: 62, minuteFeeIsk: null, minuteFeeAfterMin: null }
		]);
	});

	it('never picks the Vildarkjör loyalty prices (39/55)', () => {
		const prices = parseOnVerdskra(html).map((r) => r.priceIskPerKwh);
		expect(prices).not.toContain(39);
		expect(prices).not.toContain(55);
	});

	it('throws on a page without the expected rows (fail loud, never guess)', () => {
		expect(() => parseOnVerdskra('<html><body><p>Framar redesign!</p></body></html>')).toThrow(
			/ON parse failed/
		);
	});
});
