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
