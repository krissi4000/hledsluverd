/** Used when ORIGIN is unset (vite dev, tests) or not an absolute http(s) URL. */
export const DEFAULT_SITE_ORIGIN = 'https://hledsluverd.is';

/**
 * Public origin for canonical links, og:url and og:image, which must be absolute.
 * Reuses adapter-node's ORIGIN (set in deploy/systemd/hledsluverd.service) so the
 * site has one source of truth for its public address.
 */
export function siteOrigin(origin: string | undefined): string {
	const raw = origin?.trim();
	if (raw) {
		try {
			const u = new URL(raw);
			if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
		} catch {
			// fall through to the default
		}
	}
	return DEFAULT_SITE_ORIGIN;
}
