/** The current page's path and query with some params set (a string) or dropped (null).
 * Filters live in the URL, so every filter control is a plain link built with this. */
export function withParams(url: URL, params: Record<string, string | null>): string {
	const u = new URL(url);
	for (const [k, v] of Object.entries(params)) {
		if (v === null) u.searchParams.delete(k);
		else u.searchParams.set(k, v);
	}
	return u.pathname + u.search;
}
