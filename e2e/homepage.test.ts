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
	expect(nums).toEqual([...nums].sort((a, b) => a - b));
});

test('rate card is sorted cheapest-first', async ({ page }) => {
	await page.goto('/');
	const dcs = await page.locator('[data-testid="rate-dc"]').allTextContents();
	const nums = dcs.map(parsePrice);
	expect(nums).toEqual([...nums].sort((a, b) => a - b));
});

test('connector filter reduces or keeps the row count and every row matches', async ({ page }) => {
	await page.goto('/');
	const all = await page.locator('[data-testid="station-row"]').count();
	await page.goto('/?tengi=CHAdeMO');
	const filtered = await page.locator('[data-testid="station-row"]').count();
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

test('station list renders without JavaScript', async ({ browser }) => {
	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const page = await ctx.newPage();
	await page.goto('/');
	expect(await page.locator('[data-testid="station-row"]').count()).toBeGreaterThan(0);
	await ctx.close();
});
