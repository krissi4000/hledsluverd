import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { card, station } from '../../../../tests/helpers/share';
import { homeOgModel, ogHash, stationOgModel } from './model';
import { renderPng } from './render';
import { ogImageResponse } from './respond';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./render', async (importOriginal) => {
	const real = await importOriginal<typeof import('./render')>();
	return { ...real, renderPng: vi.fn(real.renderPng) };
});

const FALLBACK = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function event(
	path: string,
	{
		headers = {},
		fetch
	}: { headers?: Record<string, string>; fetch?: typeof globalThis.fetch } = {}
): RequestEvent {
	const url = new URL(path, 'http://localhost');
	return {
		url,
		request: new Request(url, { headers }),
		fetch:
			fetch ?? (async () => new Response(FALLBACK, { headers: { 'content-type': 'image/png' } }))
	} as unknown as RequestEvent;
}

const cards = [card('orkan', 'Orkan', 49), card('on', 'ON', 62)];
const homeBuild = async (ctx: Parameters<typeof homeOgModel>[1]) => homeOgModel(cards, ctx);

describe('ogImageResponse', () => {
	it('caches for good when ?v= matches the current picture', async () => {
		const first = await ogImageResponse(event('/og/home.png'), homeBuild);
		const hash = first.headers.get('etag')!.replaceAll('"', '');
		const res = await ogImageResponse(event(`/og/home.png?v=${hash}`), homeBuild);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	});

	it('caches briefly without ?v= or with an outdated one', async () => {
		for (const path of ['/og/home.png', '/og/home.png?v=000000000000']) {
			const res = await ogImageResponse(event(path), homeBuild);
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('public, max-age=600');
			expect(new Uint8Array(await res.arrayBuffer()).subarray(0, 4)).toEqual(
				FALLBACK.subarray(0, 4)
			);
		}
	});

	it('answers 304 to a matching If-None-Match without rendering', async () => {
		const first = await ogImageResponse(event('/og/home.png'), homeBuild);
		const etag = first.headers.get('etag')!;
		vi.mocked(renderPng).mockClear();
		const res = await ogImageResponse(
			event('/og/home.png', { headers: { 'if-none-match': etag } }),
			homeBuild
		);
		expect(res.status).toBe(304);
		expect(renderPng).not.toHaveBeenCalled();
	});

	it('renders each picture once and serves repeats from memory', async () => {
		const build = async (ctx: Parameters<typeof stationOgModel>[1]) =>
			stationOgModel(station({ slug: 'cache-test', name: 'Skyndiminni' }), ctx);
		vi.mocked(renderPng).mockClear();
		const a = await ogImageResponse(event('/og/stod/cache-test.png'), build);
		const b = await ogImageResponse(event('/og/stod/cache-test.png'), build);
		expect(renderPng).toHaveBeenCalledTimes(1);
		expect(await a.arrayBuffer()).toEqual(await b.arrayBuffer());
	});

	it('draws the locale in ?lang=, never the cookie, and ignores unknown ones', async () => {
		const seen: string[] = [];
		const build = async (ctx: Parameters<typeof homeOgModel>[1]) => {
			seen.push(ctx.locale);
			return homeOgModel(cards, ctx);
		};
		await ogImageResponse(
			event('/og/home.png?lang=en', { headers: { cookie: 'PARAGLIDE_LOCALE=is' } }),
			build
		);
		await ogImageResponse(
			event('/og/home.png?lang=xx', { headers: { cookie: 'PARAGLIDE_LOCALE=en' } }),
			build
		);
		expect(seen).toEqual(['en', 'is']);
	});

	it('serves the fallback with 404 for an unknown station', async () => {
		const res = await ogImageResponse(event('/og/stod/nope.png'), async () => null);
		expect(res.status).toBe(404);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(FALLBACK);
	});

	it('serves the fallback, not a 500, when loading the data throws', async () => {
		const res = await ogImageResponse(event('/og/home.png'), async () => {
			throw new Error('db down');
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(FALLBACK);
	});

	it('serves the fallback when rendering throws, and does not cache the failure', async () => {
		const build = async (ctx: Parameters<typeof stationOgModel>[1]) =>
			stationOgModel(station({ slug: 'render-fail', name: 'Bilun' }), ctx);
		vi.mocked(renderPng).mockRejectedValueOnce(new Error('resvg exploded'));
		const res = await ogImageResponse(event('/og/stod/render-fail.png'), build);
		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(FALLBACK);

		const retry = await ogImageResponse(event('/og/stod/render-fail.png'), build);
		expect(retry.headers.get('cache-control')).toBe('public, max-age=600');
		expect(new Uint8Array(await retry.arrayBuffer())).not.toEqual(FALLBACK);
	});

	it('redirects to the static file if even reading the fallback fails', async () => {
		const res = await ogImageResponse(
			event('/og/home.png', {
				fetch: async () => {
					throw new Error('no fs');
				}
			}),
			async () => {
				throw new Error('db down');
			}
		);
		expect(res.status).toBe(307);
		expect(res.headers.get('location')).toBe('/og-fallback.png');
	});

	it('uses the same hash as the og:image ?v= on the page', async () => {
		const res = await ogImageResponse(event('/og/home.png'), homeBuild);
		const { shareContext } = await import('../share-context');
		expect(res.headers.get('etag')).toBe(`"${ogHash(homeOgModel(cards, shareContext('is')))}"`);
	});
});
