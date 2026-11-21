// Share and search metadata. A route's load returns `seo: SeoMeta`; +layout.svelte
// fills in the defaults and renders every tag once through SeoHead, so no page
// emits its own <title>, description or og:* tags.

import type { Locale } from '$lib/paraglide/runtime';

export interface SeoMeta {
	/** <title> and og:title */
	title?: string;
	/** meta description and og:description */
	description?: string;
	/** og:image as a path on this site, including its ?v= cache-buster */
	image?: { path: string; alt: string };
	/** canonical path; defaults to the current pathname, since ?query filters are views of the same page */
	path?: string;
	noindex?: boolean;
}

/** Every og:image this site serves (dynamic and fallback) is this size. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export const OG_FALLBACK_PATH = '/og-fallback.png';

const OG_LOCALES: Record<Locale, string> = { is: 'is_IS', en: 'en_GB' };

export function ogLocale(locale: Locale): string {
	return OG_LOCALES[locale];
}

/** `origin` has no trailing slash (see siteOrigin); `path` starts with '/'. */
export function absoluteUrl(origin: string, path: string): string {
	return new URL(path, origin + '/').href;
}
