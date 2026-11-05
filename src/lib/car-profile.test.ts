import { describe, expect, it } from 'vitest';
import { carFamily, carProfile, carSize, PROFILE_HEIGHT, PROFILE_WIDTH } from './car-profile';

const none = { bodyStyle: null, lengthMm: null, heightMm: null, wheelbaseMm: null };

/** every number in an SVG path, as [x, y] pairs */
function points(d: string): [number, number][] {
	const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
	const out: [number, number][] = [];
	for (let i = 0; i < n.length; i += 2) out.push([n[i], n[i + 1]]);
	return out;
}

describe('carSize', () => {
	it('uses the real dimensions when they are plausible', () => {
		expect(
			carSize({ bodyStyle: 'sedan', lengthMm: 4960, heightMm: 1440, wheelbaseMm: 2960 })
		).toEqual([4960, 1440, 2960]);
	});

	it('falls back to the family size when dimensions are missing', () => {
		expect(carSize({ ...none, bodyStyle: 'pickup' })).toEqual([5700, 1930, 3600]);
	});

	it('ignores a wheelbase that cannot belong to the length', () => {
		const [length, , wheelbase] = carSize({
			bodyStyle: 'hatchback',
			lengthMm: 4200,
			heightMm: 1500,
			wheelbaseMm: 4100
		});
		expect(length).toBe(4200);
		expect(wheelbase).toBeLessThan(length * 0.8);
	});
});

describe('carFamily', () => {
	it('groups related body styles and defaults unknown ones to a crossover', () => {
		expect(carFamily('fastback')).toBe('coupe');
		expect(carFamily('minivan')).toBe('mpv');
		expect(carFamily('quadricycle')).toBe('micro');
		expect(carFamily(null)).toBe('crossover');
		expect(carFamily('hovercraft')).toBe('crossover');
	});
});

describe('carProfile', () => {
	it('draws every body style inside the view box', () => {
		for (const bodyStyle of ['sedan', 'van', 'pickup', 'quadricycle', 'convertible', null]) {
			const p = carProfile({ ...none, bodyStyle });
			for (const [x, y] of [...points(p.body), ...points(p.glass)]) {
				expect(x).toBeGreaterThanOrEqual(0);
				expect(x).toBeLessThanOrEqual(PROFILE_WIDTH);
				expect(y).toBeGreaterThanOrEqual(0);
				expect(y).toBeLessThanOrEqual(PROFILE_HEIGHT);
			}
		}
	});

	it('draws cars to a common scale, so a longer car is drawn longer', () => {
		const width = (d: string) => {
			const xs = points(d).map(([x]) => x);
			return Math.max(...xs) - Math.min(...xs);
		};
		const topolino = carProfile({
			bodyStyle: 'quadricycle',
			lengthMm: 2410,
			heightMm: 1520,
			wheelbaseMm: 1734
		});
		const silverado = carProfile({
			bodyStyle: 'pickup',
			lengthMm: 5842,
			heightMm: 1930,
			wheelbaseMm: 3747
		});
		expect(width(topolino.body)).toBeCloseTo(24.1, 0);
		expect(width(silverado.body)).toBeCloseTo(58.4, 0);
	});

	it('puts the axles a wheelbase apart, with the wheels on the ground', () => {
		const p = carProfile({ bodyStyle: 'sedan', lengthMm: 4960, heightMm: 1440, wheelbaseMm: 2960 });
		expect(p.wheels).toHaveLength(2);
		expect(p.wheels[1].cx - p.wheels[0].cx).toBeCloseTo(29.6, 1);
		for (const w of p.wheels) expect(w.cy + w.r).toBeCloseTo(PROFILE_HEIGHT - 0.5, 1);
	});

	it('gives single-window cabs no B-pillar', () => {
		expect(carProfile({ ...none, bodyStyle: 'van' }).pillar).toBeNull();
		expect(carProfile({ ...none, bodyStyle: 'sedan' }).pillar).not.toBeNull();
	});
});
