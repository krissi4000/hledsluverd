import { describe, expect, it } from 'vitest';
import { dailyBudget, hasPanorama, metadataUrl, photoUrl, signPath } from './streetview';

const AT = { lat: 64.146, lng: -21.942 };
const CFG = { key: 'TESTKEY' };

describe('signPath', () => {
	it("matches Google's HMAC-SHA1 scheme with a base64url secret", () => {
		// expected value computed independently with openssl (hexkey of the decoded secret)
		expect(
			signPath(
				'/maps/api/staticmap?center=Z%C3%BCrich&size=400x400&key=YOUR_API_KEY',
				'vNIXE0xscrmjlyV-12Nj_BvUPaw='
			)
		).toBe('fEozaSHlfWnrEnLYHRval0H1FKY=');
	});
});

describe('photoUrl / metadataUrl', () => {
	it('asks for an outdoor panorama near the station, aimed at it (no heading)', () => {
		const u = new URL(photoUrl(AT, CFG));
		expect(u.origin + u.pathname).toBe('https://maps.googleapis.com/maps/api/streetview');
		expect(u.searchParams.get('location')).toBe('64.146000,-21.942000');
		expect(u.searchParams.get('size')).toBe('240x180');
		expect(u.searchParams.get('source')).toBe('outdoor');
		expect(u.searchParams.get('return_error_code')).toBe('true');
		expect(u.searchParams.get('key')).toBe('TESTKEY');
		expect(u.searchParams.has('heading')).toBe(false);
		expect(u.searchParams.has('signature')).toBe(false);
	});

	it('signs exactly the path and query it sends when a secret is set', () => {
		const secret = 'vNIXE0xscrmjlyV-12Nj_BvUPaw=';
		const url = metadataUrl(AT, { ...CFG, signingSecret: secret });
		const [unsigned, signature] = url.split('&signature=');
		const pathAndQuery = unsigned.slice('https://maps.googleapis.com'.length);
		expect(pathAndQuery.startsWith('/maps/api/streetview/metadata?')).toBe(true);
		expect(signature).toBe(signPath(pathAndQuery, secret));
	});
});

describe('hasPanorama', () => {
	const reply = (body: unknown, status = 200) =>
		(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

	it('is true for OK and false when Google has no panorama there', async () => {
		expect(await hasPanorama(AT, CFG, reply({ status: 'OK', pano_id: 'x' }))).toBe(true);
		expect(await hasPanorama(AT, CFG, reply({ status: 'ZERO_RESULTS' }))).toBe(false);
		expect(await hasPanorama(AT, CFG, reply({ status: 'NOT_FOUND' }))).toBe(false);
	});

	it('throws on anything else, so a bad key or quota never reads as "no photo"', async () => {
		await expect(hasPanorama(AT, CFG, reply({ status: 'REQUEST_DENIED' }))).rejects.toThrow(
			'REQUEST_DENIED'
		);
		await expect(hasPanorama(AT, CFG, reply({}, 500))).rejects.toThrow('HTTP 500');
	});
});

describe('dailyBudget', () => {
	it('hands out at most `limit` a day and starts over the next day', () => {
		let now = Date.parse('2026-11-20T10:00:00Z');
		const budget = dailyBudget(2, () => now);
		expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
		now = Date.parse('2026-11-20T23:59:00Z');
		expect(budget.take()).toBe(false);
		now = Date.parse('2026-11-21T00:01:00Z');
		expect(budget.take()).toBe(true);
	});
});
