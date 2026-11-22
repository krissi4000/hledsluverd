import type { RequestEvent } from '@sveltejs/kit';
import { isLocale } from '$lib/paraglide/runtime';
import { OG_FALLBACK_PATH } from '$lib/seo';
import type { ShareContext } from '../share';
import { shareContext } from '../share-context';
import { ogFonts } from './fonts';
import { ogHash, type OgModel } from './model';
import { renderPng } from './render';
import { homeTree, stationTree } from './templates';

/** ~50 KB each; plenty for the homepage plus every station shared in a day. */
const MAX_CACHED = 300;

// hash → PNG. Promises, so concurrent requests for one picture render it once.
const cache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

export function renderCached(hash: string, model: OgModel): Promise<Uint8Array<ArrayBuffer>> {
	const hit = cache.get(hash);
	if (hit) {
		// re-insert: Map order doubles as least-recently-used order
		cache.delete(hash);
		cache.set(hash, hit);
		return hit;
	}
	const tree = model.kind === 'home' ? homeTree(model) : stationTree(model);
	const png = renderPng(tree, ogFonts()).then((b) => new Uint8Array(b));
	cache.set(hash, png);
	png.catch(() => {
		if (cache.get(hash) === png) cache.delete(hash);
	});
	while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
	return png;
}

/**
 * Serves an og:image. Never a 500: if the data or the render fails, it serves
 * static/og-fallback.png, which shows no prices and so cannot be wrong.
 * The picture depends only on the URL (?lang=, never the cookie), so public
 * caching is safe.
 */
export async function ogImageResponse(
	event: RequestEvent,
	build: (ctx: ShareContext) => Promise<OgModel | null>
): Promise<Response> {
	try {
		const lang = event.url.searchParams.get('lang');
		const model = await build(shareContext(lang && isLocale(lang) ? lang : 'is'));
		if (!model) return fallback(event, 404);

		const hash = ogHash(model);
		const etag = `"${hash}"`;
		const headers = {
			'content-type': 'image/png',
			etag,
			// ?v= matches: this URL is exactly this picture (the hash covers the template
			// version too), so it can be cached for good. Without it, or with an old
			// share's ?v=, the picture is today's and may change.
			'cache-control':
				event.url.searchParams.get('v') === hash
					? 'public, max-age=31536000, immutable'
					: 'public, max-age=600'
		};
		if (event.request.headers.get('if-none-match') === etag) {
			return new Response(null, { status: 304, headers });
		}
		return new Response(await renderCached(hash, model), { headers });
	} catch (err) {
		console.error('og image failed, serving the fallback:', err);
		return fallback(event, 200);
	}
}

async function fallback(event: RequestEvent, status: number): Promise<Response> {
	// no-store: a failure must not stick in Facebook's or a proxy's cache
	const headers = { 'content-type': 'image/png', 'cache-control': 'no-store' };
	try {
		// SvelteKit answers its own static files in-process (adapter-node reads build/client)
		const res = await event.fetch(OG_FALLBACK_PATH);
		if (res.ok) return new Response(await res.arrayBuffer(), { status, headers });
	} catch {
		// fall through to the redirect
	}
	return new Response(null, {
		status: 307,
		headers: { location: OG_FALLBACK_PATH, 'cache-control': 'no-store' }
	});
}
