import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Link previews (Facebook, Messenger, X, Slack) read these tags without running JS.

const content = (page: Page, selector: string) =>
	page.locator(`head ${selector}`).getAttribute('content');

/** fetches an absolute og:image URL from the server under test (ORIGIN may differ) */
async function fetchImage(request: APIRequestContext, image: string) {
	const u = new URL(image);
	const res = await request.get(u.pathname + u.search);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toBe('image/png');
	// ?v= is the current hash, so the URL is exactly this picture
	expect(res.headers()['cache-control']).toContain('immutable');
	const png = await res.body();
	expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
}

test('homepage has one set of absolute share tags and a working, versioned og:image', async ({
	page,
	request
}) => {
	await page.goto('/?afl=AC');
	for (const tag of [
		'og:title',
		'og:description',
		'og:site_name',
		'og:image:alt',
		'og:image:width',
		'og:image:height'
	]) {
		expect(await content(page, `meta[property="${tag}"]`), tag).toBeTruthy();
	}
	expect(await content(page, 'meta[property="og:locale"]')).toBe('is_IS');
	expect(await content(page, 'meta[name="twitter:card"]')).toBe('summary_large_image');
	// filters are views of the same page: canonical and og:url drop the query
	expect(await content(page, 'meta[property="og:url"]')).toMatch(/^https?:\/\/[^/]+\/$/);
	await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
		'href',
		/^https?:\/\/[^/]+\/$/
	);
	// the layout renders the tags once; pages must not add their own
	await expect(page.locator('head title')).toHaveCount(1);
	await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
	await expect(page.locator('head meta[property="og:image"]')).toHaveCount(1);

	const image = await content(page, 'meta[property="og:image"]');
	expect(image).toMatch(/^https?:\/\/[^/]+\/og\/home\.png\?v=[0-9a-f]{12}$/);
	await fetchImage(request, image!);
});

test('a station page shares its own image and description', async ({ page, request }) => {
	await page.goto('/');
	const href = await page
		.locator('[data-testid="station-row"] a[href^="/stod/"]')
		.first()
		.getAttribute('href');
	await page.goto(href!);
	const slug = href!.split('/').pop()!;

	const image = await content(page, 'meta[property="og:image"]');
	expect(image).toMatch(new RegExp(`/og/stod/${slug}\\.png\\?v=[0-9a-f]{12}$`));
	expect(await content(page, 'meta[name="description"]')).toMatch(/kWh|verð óþekkt/);
	await fetchImage(request, image!);
});

test('og images never 500: an unknown station gets the fallback picture', async ({ request }) => {
	const res = await request.get('/og/stod/finnst-ekki.png');
	expect(res.status()).toBe(404);
	expect(res.headers()['content-type']).toBe('image/png');
	expect(res.headers()['cache-control']).toBe('no-store');
});
