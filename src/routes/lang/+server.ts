import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Only same-origin destinations. String checks are not enough here: the WHATWG URL
// parser browsers apply to the Location header strips tab/CR/LF anywhere in the value
// (so '/\t/evil.com' becomes protocol-relative '//evil.com') and treats '\' as '/'.
// Parse the way the browser will and require the origin to stay on our sentinel base.
function safeRedirect(target: string | null): string {
	if (!target) return '/';
	try {
		const u = new URL(target, 'http://sentinel.invalid');
		if (u.origin !== 'http://sentinel.invalid') return '/';
		return u.pathname + u.search + u.hash;
	} catch {
		return '/';
	}
}

// Deliberate tradeoff: a GET that sets a cookie, so the toggle works without JS.
// A forged request can only flip the display language (cosmetic). Note the SSR output
// varies by this cookie — any future CDN/proxy caching needs Vary: Cookie handling.
export const GET: RequestHandler = ({ url, cookies }) => {
	const to = url.searchParams.get('to') === 'en' ? 'en' : 'is';
	cookies.set('PARAGLIDE_LOCALE', to, { path: '/', maxAge: 60 * 60 * 24 * 365 });
	redirect(303, safeRedirect(url.searchParams.get('redirect')));
};
