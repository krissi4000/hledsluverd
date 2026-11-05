import { describe, expect, it } from 'vitest';
import {
	carProfile,
	carShape,
	carSize,
	modelKey,
	PROFILE_HEIGHT,
	PROFILE_WIDTH,
	type CarShape
} from './car-profile';
import { MODEL_SHAPES, PRESETS } from './car-shapes';

const noSize = { lengthMm: null, heightMm: null, wheelbaseMm: null };
const unknown = (bodyStyle: string | null): CarShape => ({
	make: 'Nobody',
	model: 'Concept',
	bodyStyle,
	...noSize
});

/** every number in an SVG path, as [x, y] pairs */
function points(d: string): [number, number][] {
	const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
	const out: [number, number][] = [];
	for (let i = 0; i < n.length; i += 2) out.push([n[i], n[i + 1]]);
	return out;
}

const width = (d: string) => {
	const xs = points(d).map(([x]) => x);
	return Math.max(...xs) - Math.min(...xs);
};

describe('modelKey', () => {
	it('slugs make and model the way car-shapes.ts keys them', () => {
		expect(modelKey('Škoda', 'Enyaq Coupé iV')).toBe('skoda/enyaq-coupe-iv');
		expect(modelKey('Volkswagen', 'ID. Buzz')).toBe('volkswagen/id-buzz');
		expect(modelKey('Smart', '#1')).toBe('smart/1');
	});
});

describe('carShape', () => {
	it("uses the model's own shape when it has one", () => {
		const { shape, preset } = carShape({ make: 'Tesla', model: 'Model 3', bodyStyle: 'sedan' });
		expect(preset).toBe('fastsedan');
		expect(shape.roofRear).toEqual(MODEL_SHAPES['tesla/model-3'].roofRear);
	});

	it('falls back to the body-style preset for unknown models, and a crossover for unknown styles', () => {
		expect(carShape(unknown('van')).shape).toEqual(PRESETS.van);
		expect(carShape(unknown(null)).preset).toBe('crossover');
		expect(carShape(unknown('hovercraft')).preset).toBe('crossover');
	});
});

describe('carSize', () => {
	it('uses the real dimensions when they are plausible', () => {
		expect(
			carSize({
				make: 'Audi',
				model: 'A6 e-tron',
				bodyStyle: 'sedan',
				lengthMm: 4960,
				heightMm: 1440,
				wheelbaseMm: 2960
			})
		).toEqual([4960, 1440, 2960]);
	});

	it('prefers a curated size over missing or wrong dataset dimensions', () => {
		expect(carSize({ make: 'Ferrari', model: '296 GTB', bodyStyle: 'coupe', ...noSize })).toEqual([
			4565, 1187, 2600
		]);
		// the dataset has 1900 mm (roof box) for the Renault 4
		expect(
			carSize({
				make: 'Renault',
				model: '4 E-Tech',
				bodyStyle: 'crossover',
				lengthMm: 4160,
				heightMm: 1900,
				wheelbaseMm: 2570
			})[1]
		).toBe(1570);
	});

	it('falls back to the typical size when nothing is known', () => {
		expect(carSize(unknown('van'))).toEqual([5300, 2050, 3300]);
	});

	it('ignores a wheelbase that cannot belong to the length', () => {
		const [length, , wheelbase] = carSize({
			...unknown('hatchback'),
			lengthMm: 4200,
			heightMm: 1500,
			wheelbaseMm: 4100
		});
		expect(length).toBe(4200);
		expect(wheelbase).toBeLessThan(length * 0.8);
	});
});

describe('carProfile', () => {
	const models = Object.keys(MODEL_SHAPES).map((k) => {
		const [make, model] = k.split('/');
		return { make, model, bodyStyle: null, ...noSize };
	});

	it('draws every model inside the view box', () => {
		for (const car of models) {
			const p = carProfile(car);
			for (const [x, y] of [...points(p.body), ...points(p.glass)]) {
				expect(x, car.model).toBeGreaterThanOrEqual(0);
				expect(x, car.model).toBeLessThanOrEqual(PROFILE_WIDTH);
				expect(y, car.model).toBeGreaterThanOrEqual(0);
				expect(y, car.model).toBeLessThanOrEqual(PROFILE_HEIGHT);
			}
			expect(p.glass, car.model).not.toBe('Z');
		}
	});

	it('gives cars of the same size but different models different outlines', () => {
		const size = { lengthMm: 4700, heightMm: 1450, wheelbaseMm: 2900 };
		const model3 = carProfile({ make: 'Tesla', model: 'Model 3', bodyStyle: 'sedan', ...size });
		const ioniq6 = carProfile({ make: 'Hyundai', model: 'IONIQ 6', bodyStyle: 'sedan', ...size });
		const i5 = carProfile({ make: 'BMW', model: 'i5', bodyStyle: 'sedan', ...size });
		expect(new Set([model3.body, ioniq6.body, i5.body]).size).toBe(3);
	});

	it('draws cars to a common scale, so a longer car is drawn longer', () => {
		const topolino = carProfile({
			make: 'Fiat',
			model: 'Topolino',
			bodyStyle: 'quadricycle',
			lengthMm: 2410,
			heightMm: 1520,
			wheelbaseMm: 1734
		});
		const transit = carProfile({ make: 'Ford', model: 'E-Transit', bodyStyle: 'van', ...noSize });
		expect(width(topolino.body)).toBeCloseTo(24.1, 0);
		expect(width(transit.body)).toBeCloseTo(55.3, 0);
	});

	it('puts the axles a wheelbase apart, with the wheels on the ground', () => {
		const p = carProfile({
			make: 'Audi',
			model: 'A6 e-tron',
			bodyStyle: 'sedan',
			lengthMm: 4960,
			heightMm: 1440,
			wheelbaseMm: 2960
		});
		expect(p.wheels).toHaveLength(2);
		expect(p.wheels[1].cx - p.wheels[0].cx).toBeCloseTo(29.6, 1);
		for (const w of p.wheels) expect(w.cy + w.r).toBeCloseTo(PROFILE_HEIGHT - 0.5, 1);
	});

	it('keeps a cargo van glass in the cab only', () => {
		const p = carProfile({ make: 'Ford', model: 'E-Transit', bodyStyle: 'van', ...noSize });
		const body = points(p.body).map(([x]) => x);
		const rear = Math.min(...body);
		const glassRear = Math.min(...points(p.glass).map(([x]) => x));
		expect(glassRear - rear).toBeGreaterThan(0.6 * width(p.body));
	});

	it('hangs a spare wheel on the G-Class only', () => {
		expect(
			carProfile({ make: 'Mercedes-Benz', model: 'G 580 EQ', bodyStyle: 'suv', ...noSize }).spare
		).not.toBeNull();
		expect(carProfile({ make: 'BMW', model: 'iX', bodyStyle: 'suv', ...noSize }).spare).toBeNull();
	});
});
