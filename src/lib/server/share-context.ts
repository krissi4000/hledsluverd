import { env } from '$env/dynamic/private';
import { getLocale, type Locale } from '$lib/paraglide/runtime';
import type { ShareContext } from './share';
import { siteOrigin } from './site';

/** Context for the current request. Page loads use the request's locale; the og
 * endpoints pass the locale from their ?lang= param, so the image URL alone
 * decides what is drawn. */
export function shareContext(locale: Locale = getLocale(), now = new Date()): ShareContext {
	return { locale, now, domain: new URL(siteOrigin(env.ORIGIN)).host };
}
