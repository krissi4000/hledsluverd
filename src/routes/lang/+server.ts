import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Deliberate tradeoff: a GET that sets a cookie, so the toggle works without JS.
// A forged request can only flip the display language (cosmetic). Note the SSR output
// varies by this cookie — any future CDN/proxy caching needs Vary: Cookie handling.
export const GET: RequestHandler = ({ url, cookies }) => {
	const to = url.searchParams.get('to') === 'en' ? 'en' : 'is';
	cookies.set('PARAGLIDE_LOCALE', to, { path: '/', maxAge: 60 * 60 * 24 * 365 });
	const target = url.searchParams.get('redirect') ?? '/';
	// Only same-origin relative paths: require a leading '/' NOT followed by '/' or '\\' —
	// browsers treat both '//host' and '/\\host' as protocol-relative, i.e. an open redirect.
	redirect(303, /^\/(?![/\\])/.test(target) ? target : '/');
};
