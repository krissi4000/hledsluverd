import { expect, test } from '@playwright/test';

function parsePrice(text: string): number {
	return parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''));
}

test('homepage renders the rate card and a station list sorted by price', async ({ page }) => {
	await page.goto('/');
	expect(await page.locator('[data-testid="rate-card"]').count()).toBeGreaterThan(0);

	const prices = await page
		.locator('[data-testid="station-row"] [data-testid="price"]')
		.allTextContents();
	expect(prices.length).toBeGreaterThan(0);
	const nums = prices.map(parsePrice);
	// NaN === NaN under toEqual, so a formatter change must not slip past as NaN
	for (const n of nums) expect(Number.isFinite(n)).toBe(true);
	expect(nums).toEqual([...nums].sort((a, b) => a - b));

	// unknown-price rows render no price cell and must sort last; some networks
	// (Tesla) stay app-priced indefinitely, so such rows always exist
	const rows = page.locator('[data-testid="station-row"]');
	await expect(rows.first().locator('[data-testid="price"]')).toHaveCount(1);
	await expect(rows.last().locator('[data-testid="price"]')).toHaveCount(0);
});

test('rate card is sorted cheapest-first', async ({ page }) => {
	await page.goto('/');
	const dcs = await page.locator('[data-testid="rate-dc"]').allTextContents();
	expect(dcs.length).toBeGreaterThan(0);
	const nums = dcs.map(parsePrice);
	expect(nums).toEqual([...nums].sort((a, b) => a - b));
});

test('connector filter reduces or keeps the row count and every row matches', async ({ page }) => {
	await page.goto('/');
	const all = await page.locator('[data-testid="station-row"]').count();
	await page.goto('/?tengi=CHAdeMO');
	const filtered = await page.locator('[data-testid="station-row"]').count();
	expect(filtered).toBeGreaterThan(0);
	expect(filtered).toBeLessThanOrEqual(all);
	const rows = page.locator('[data-testid="station-row"]');
	for (let i = 0; i < Math.min(filtered, 10); i++) {
		await expect(rows.nth(i)).toContainText('CHAdeMO');
	}
});

test('language toggle switches to English and back, without JavaScript', async ({ browser }) => {
	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.locator('header .tagline')).toContainText('á einum stað');
	await page.locator('[data-testid="lang-toggle"]').click();
	await expect(page.locator('header .tagline')).toContainText('in one place');
	await page.locator('[data-testid="lang-toggle"]').click();
	await expect(page.locator('header .tagline')).toContainText('á einum stað');
	await ctx.close();
});

test('language redirect refuses to leave the site', async ({ request }) => {
	// %09 = tab: browsers strip tab/CR/LF from Location, turning '/\t/evil.com'
	// into protocol-relative '//evil.com' — the guard must parse like a browser
	const attacks = [
		'//evil.com',
		'/\\evil.com',
		'/%09/evil.com',
		'/%0a/evil.com',
		'https://evil.com'
	];
	for (const attack of attacks) {
		const res = await request.get(`/lang?to=en&redirect=${attack}`, { maxRedirects: 0 });
		expect(res.status()).toBe(303);
		expect(res.headers()['location']).toBe('/');
	}
	const ok = await request.get('/lang?to=en&redirect=%2F%3Fafl%3DAC', { maxRedirects: 0 });
	expect(ok.headers()['location']).toBe('/?afl=AC');
});

test('station list renders without JavaScript', async ({ browser }) => {
	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const page = await ctx.newPage();
	await page.goto('/');
	expect(await page.locator('[data-testid="station-row"]').count()).toBeGreaterThan(0);
	await ctx.close();
});

test('trend page draws the chart and offers a no-JS table', async ({ page, browser }) => {
	await page.goto('/');
	await page.locator('nav a[href="/verdthroun"]').click();
	await expect(page.locator('[data-testid="trend-chart"]')).toBeVisible();

	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const noJs = await ctx.newPage();
	await noJs.goto('/verdthroun');
	expect(await noJs.locator('[data-testid="trend-row"]').count()).toBeGreaterThan(0);
	await ctx.close();
});

test('station page shows prices, availability honesty and the trend graph', async ({ page }) => {
	await page.goto('/');
	await page.locator('[data-testid="station-row"] a').first().click();
	await expect(page.locator('article h2')).toBeVisible();
	expect(await page.locator('[data-testid="station-price"]').count()).toBeGreaterThan(0);
	// availability is best-effort: either n/m or the honest "—", never a bare 0
	await expect(page.locator('[data-testid="station-availability"]')).toHaveText(/—|\d+\/\d+/);
	await expect(page.locator('[data-testid="station-trend"]')).toBeVisible();
});

test('map page renders price pins and a mini-card linking to the station', async ({ page }) => {
	await page.goto('/kort');
	const pins = page.locator('[data-testid="map-pin"]');
	await expect(pins.first()).toBeVisible({ timeout: 15000 });
	expect(await pins.count()).toBeGreaterThan(10);
	await pins.first().click();
	const card = page.locator('[data-testid="map-card"]');
	await expect(card).toBeVisible();
	await expect(card.locator('a[href^="/stod/"]').first()).toBeVisible();
	await expect(card.locator('[data-testid="card-availability"]')).toHaveText(/—|\d+\/\d+/);
});

test('finder flow: pick a car, get compatible stations with speed and distance', async ({
	browser
}) => {
	const ctx = await browser.newContext({
		geolocation: { latitude: 64.1466, longitude: -21.9426 },
		permissions: ['geolocation'],
		baseURL: 'http://localhost:4173'
	});
	const page = await ctx.newPage();
	await page.goto('/bilaleit');
	await page.locator('[data-testid="car-search"]').fill('Leaf');
	await page.locator('[data-testid="car-hits"] button').first().click();
	await expect(page.locator('[data-testid="chosen-car"]')).toBeVisible();
	await expect(page.locator('[data-testid="compatible-count"]')).toBeVisible();
	const rows = page.locator('[data-testid="finder-results"] li');
	expect(await rows.count()).toBeGreaterThan(0);
	await expect(rows.first()).toContainText(/kW/);
	// distance appears once geolocation is applied
	await page.getByRole('button', { name: /staðsetningu|location/i }).click();
	await expect(rows.first()).toContainText(/km/, { timeout: 10000 });
	await ctx.close();
});

test('admin page renders health, prices and forms', async ({ page }) => {
	await page.goto('/admin');
	await expect(page.locator('[data-testid="admin-health"]')).toBeVisible();
	await expect(page.locator('[data-testid="admin-prices"] tr').first()).toBeVisible();
	await expect(page.locator('[data-testid="admin-price-form"]')).toBeVisible();
	// never let the admin page leak into search results
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});
