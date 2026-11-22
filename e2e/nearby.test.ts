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

test('nearby cards: at most 20, each with a distance, led by the kWh price', async ({ page }) => {
	await page.goto(`/?nalaegt=${RVK}`);
	const cards = page.locator('[data-testid="nearby-card"]');
	const n = await cards.count();
	expect(n).toBeGreaterThan(0);
	expect(n).toBeLessThanOrEqual(20);
	await expect(cards.locator('[data-testid="distance"]')).toHaveCount(n);
	// the headline is the known kWh price; no full-charge estimate on the cards' faces,
	// and without a car or battery size none anywhere: never a guess
	await expect(cards.locator('[data-testid="price"]').first()).toContainText(/^\d+(,\d)? kr\/kWh$/);
	await expect(page.locator('[data-testid="full-charge-cost"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="battery-form"]')).toHaveCount(0);
});

test('a card opens its full-charge estimate, asking for a battery size first', async ({ page }) => {
	// the toggle needs the page hydrated
	await page.goto(`/?nalaegt=${RVK}`, { waitUntil: 'networkidle' });
	const card = page
		.locator('[data-testid="nearby-card"]', { has: page.locator('[data-testid="price"]') })
		.first();
	// every card's main action is the way there
	await expect(card.locator('[data-testid="directions"]')).toHaveAttribute(
		'href',
		/google\.com\/maps\/dir\//
	);

	// pressing the card itself (not a link) opens it; with no battery size it asks for one
	await card.locator('.facts').click();
	const form = card.locator('[data-testid="battery-form"]');
	await expect(form).toBeVisible();
	await form.locator('[data-testid="battery-input"]').fill('60');
	await form.locator('button').click();
	await expect(page).toHaveURL(/rafhlada=60/);
	// the other filters survive the battery form
	await expect(page).toHaveURL(/nalaegt=/);

	// the same card stays open (the order doesn't depend on the battery) with the estimate
	await expect(card.locator('[data-testid="full-charge-cost"]')).toContainText(/≈ [\d.]+ kr/);
	await expect(card.locator('[data-testid="full-charge-time"]')).toContainText('≈');
	const explainer = card.locator('[data-testid="charge-explainer"]');
	await expect(explainer).toBeVisible();
	await expect(card.locator('[data-testid="breakdown"]')).toContainText('60 kWh');
	// with no car chosen it says what it assumed about the car
	await expect(explainer).toContainText('Enginn bíll er valinn');
	// a static picture with a text alternative, no slider to operate
	await expect(explainer.locator('svg[role="img"]')).toHaveAttribute(
		'aria-label',
		/^Kostnaður hleðslunnar með tímanum: um [\d.]+ kr eftir um .+\.$/
	);
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
