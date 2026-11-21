import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupPlate, resetPlateLookup } from './plate-lookup';

const body = (name: string) =>
	readFileSync(`tests/fixtures/island-vehicle-search/${name}.json`, 'utf8');
const registry = (name = 'electric') => vi.fn(async () => new Response(body(name)));
const at = (iso: string) => new Date(iso);

describe('lookupPlate', () => {
	beforeEach(() => resetPlateLookup());

	it('asks the registry once and serves repeats from the cache for a day', async () => {
		const fetchFn = registry();
		const opts = { client: 'a', fetchFn: fetchFn as typeof fetch };
		const first = await lookupPlate('AB123', { ...opts, now: at('2026-11-20T10:00:00Z') });
		expect(first).toMatchObject({ status: 'ok', vehicle: { commercialName: '2008' } });
		await lookupPlate('AB123', { ...opts, client: 'b', now: at('2026-11-21T09:00:00Z') });
		expect(fetchFn).toHaveBeenCalledTimes(1);
		await lookupPlate('AB123', { ...opts, now: at('2026-11-21T11:00:00Z') });
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('caches an unknown plate for an hour', async () => {
		const fetchFn = registry('not-found');
		const opts = { client: 'a', fetchFn: fetchFn as typeof fetch };
		expect(await lookupPlate('ZZ999', { ...opts, now: at('2026-11-20T10:00:00Z') })).toEqual({
			status: 'ok',
			vehicle: null
		});
		await lookupPlate('ZZ999', { ...opts, now: at('2026-11-20T10:30:00Z') });
		await lookupPlate('ZZ999', { ...opts, now: at('2026-11-20T11:30:00Z') });
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('limits each visitor to 20 registry lookups an hour', async () => {
		const fetchFn = registry() as unknown as typeof fetch;
		const now = at('2026-11-20T10:00:00Z');
		for (let i = 0; i < 20; i++) {
			const r = await lookupPlate(`AB${100 + i}`, { client: 'a', fetchFn, now });
			expect(r.status).toBe('ok');
		}
		expect(await lookupPlate('AB200', { client: 'a', fetchFn, now })).toEqual({ status: 'busy' });
		// someone else, or the same visitor an hour later, can still look up
		expect((await lookupPlate('AB200', { client: 'b', fetchFn, now })).status).toBe('ok');
		const later = at('2026-11-20T11:00:01Z');
		expect((await lookupPlate('AB201', { client: 'a', fetchFn, now: later })).status).toBe('ok');
	});

	it('stops at the daily budget across all visitors', async () => {
		const fetchFn = registry() as unknown as typeof fetch;
		const now = at('2026-11-20T10:00:00Z');
		for (let i = 0; i < 1000; i++) {
			await lookupPlate(`P${i}`, { client: `c${i}`, fetchFn, now });
		}
		expect(await lookupPlate('XX999', { client: 'new', fetchFn, now })).toEqual({
			status: 'busy'
		});
		const tomorrow = at('2026-11-21T00:00:01Z');
		expect((await lookupPlate('XX999', { client: 'new', fetchFn, now: tomorrow })).status).toBe(
			'ok'
		);
	});

	it('passes a registry failure on, uncached', async () => {
		const fetchFn = registry('error') as unknown as typeof fetch;
		const opts = { client: 'a', fetchFn, now: at('2026-11-20T10:00:00Z') };
		await expect(lookupPlate('AB123', opts)).rejects.toThrow(/Internal server error/);
		await expect(lookupPlate('AB123', opts)).rejects.toThrow();
	});
});
