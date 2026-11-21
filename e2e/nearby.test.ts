import { expect, test } from '@playwright/test';

// Reykjavík city centre, rounded like the "Nálægt mér" button rounds it
const RVK = '64.146,-21.942';

test('"Nálægt mér" asks for the location on click and shows nearby cards', async ({ browser }) => {
	const ctx = await browser.newContext({
		geolocation: { latitude: 64.14612, longitude: -21.94231 },
		permissions: ['geolocation']
	});
	const page = await ctx.newPage();
	await page.goto('/');
	await page.locator('[data-testid="near-me"]').click();
	await expect.poll(() => new URL(page.url()).searchParams.get('nalaegt')).toBe(RVK);
	await expect(page.locator('[data-testid="nearby-list"]')).toBeVisible();
	// the cards replace the table
	await expect(page.locator('[data-testid="station-row"]')).toHaveCount(0);
	await ctx.close();
});

test('nearby cards: at most 20, each with a distance, unknown cost without a battery', async ({
	page
}) => {
	await page.goto(`/?nalaegt=${RVK}`);
	const cards = page.locator('[data-testid="nearby-card"]');
	const n = await cards.count();
	expect(n).toBeGreaterThan(0);
	expect(n).toBeLessThanOrEqual(20);
	await expect(cards.locator('[data-testid="distance"]')).toHaveCount(n);
	// no car and no battery size: the full charge is "unknown", never a guess
	await expect(page.locator('[data-testid="full-charge-cost"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="battery-form"]')).toBeVisible();
});

test('a battery size prices the full charge; the card opens its explanation', async ({ page }) => {
	await page.goto(`/?nalaegt=${RVK}`);
	await page.locator('[data-testid="battery-input"]').fill('60');
	await page.locator('[data-testid="battery-form"] button').click();
	await expect(page).toHaveURL(/rafhlada=60/);
	// the other filters survive the battery form
	await expect(page).toHaveURL(/nalaegt=/);

	const card = page
		.locator('[data-testid="nearby-card"]', {
			has: page.locator('[data-testid="full-charge-cost"]')
		})
		.first();
	await expect(card.locator('[data-testid="full-charge-cost"]')).toContainText(/≈ [\d.]+ kr/);

	// the info button explains the average power
	await card.locator('[data-testid="avg-info"]').click();
	await expect(card.locator('.info-text')).toBeVisible();

	// the explanation is hidden until the card itself (not a link) is pressed
	const explainer = card.locator('[data-testid="charge-explainer"]');
	await expect(explainer).toHaveCount(0);
	await card.locator('.facts').click();
	await expect(explainer).toBeVisible();
	await expect(card.locator('[data-testid="breakdown"]')).toContainText('60 kWh');
	// a static picture with a text alternative, no slider to operate
	await expect(explainer.locator('svg[role="img"]')).toHaveAttribute('aria-label', /≈ [\d.]+ kr/);
	await expect(explainer.locator('[role="slider"]')).toHaveCount(0);
	await card.locator('[data-testid="explain-toggle"]').click();
	await expect(explainer).toHaveCount(0);
});

test('without a Google key the cards keep their logos and ask Google for nothing', async ({
	page,
	request
}) => {
	await page.goto(`/?nalaegt=${RVK}`);
	await expect(page.locator('[data-testid="nearby-card"]').first()).toBeVisible();
	await expect(page.locator('[data-testid="station-photo"]')).toHaveCount(0);
	const href = await page
		.locator('[data-testid="nearby-card"] a.name')
		.first()
		.getAttribute('href');
	expect((await request.get(`${href}/mynd`, { maxRedirects: 0 })).status()).toBe(404);
	expect((await request.get('/stod/engin-stod/mynd', { maxRedirects: 0 })).status()).toBe(404);
});
