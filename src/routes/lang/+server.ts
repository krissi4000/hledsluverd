import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies }) => {
	const to = url.searchParams.get('to') === 'en' ? 'en' : 'is';
	cookies.set('PARAGLIDE_LOCALE', to, { path: '/', maxAge: 60 * 60 * 24 * 365 });
	const target = url.searchParams.get('redirect') ?? '/';
	// only same-origin relative paths — an absolute or scheme-relative URL here would be an open redirect
	redirect(303, target.startsWith('/') && !target.startsWith('//') ? target : '/');
};
