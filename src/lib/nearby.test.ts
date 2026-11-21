import { describe, expect, it } from 'vitest';
import {
	NEARBY_COUNT,
	RULES,
	fuzzyScore,
	memberships,
	parseBattery,
	rankNearby,
	type Rankable
} from './nearby';

const st = (name: string, distanceKm: number, rankPrice: number | null): Rankable => ({
	name,
	distanceKm,
	rankPrice
});
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe('parseBattery', () => {
	it('reads a kWh figure, with a decimal comma or point', () => {
		expect(parseBattery('60')).toBe(60);
		expect(parseBattery('77,4')).toBe(77.4);
		expect(parseBattery(' 58.0 ')).toBe(58);
	});

	it('rejects junk and implausible sizes', () => {
		for (const raw of [null, '', 'abc', '-40', '1e3', '4', '400', '60kWh']) {
			expect(parseBattery(raw)).toBeNull();
		}
	});
});

describe('memberships', () => {
	it('always add up to 1', () => {
		for (const x of [0, 0.1, 0.25, 0.5, 0.7, 1]) {
			const m = memberships(x);
			expect(m[0] + m[1] + m[2]).toBeCloseTo(1);
		}
	});

	it('is fully low at 0, fully mid at 0.5, fully high at 1, clamped outside', () => {
		expect(memberships(0)).toEqual([1, 0, 0]);
		expect(memberships(0.5)).toEqual([0, 1, 0]);
		expect(memberships(1)).toEqual([0, 0, 1]);
		expect(memberships(-3)).toEqual([1, 0, 0]);
		expect(memberships(7)).toEqual([0, 0, 1]);
	});
});

describe('fuzzyScore', () => {
	it('returns the rule outputs at the corners', () => {
		expect(fuzzyScore(0, 0)).toBe(RULES[0][0]);
		expect(fuzzyScore(0, 1)).toBe(RULES[0][2]);
		expect(fuzzyScore(1, 0)).toBe(RULES[2][0]);
		expect(fuzzyScore(1, 1)).toBe(RULES[2][2]);
	});

	it('weighs distance more than price', () => {
		// the same step on each scale: moving away costs more than getting dearer
		expect(fuzzyScore(0, 0) - fuzzyScore(0.5, 0)).toBeGreaterThan(
			fuzzyScore(0, 0) - fuzzyScore(0, 0.5)
		);
		expect(fuzzyScore(0.2, 1)).toBeGreaterThan(fuzzyScore(0.8, 0));
	});

	it('never ranks a nearer and cheaper station lower', () => {
		const xs = [0, 0.15, 0.3, 0.5, 0.65, 0.8, 1];
		for (const d of xs) {
			for (const p of xs) {
				for (const d2 of xs.filter((v) => v >= d)) {
					for (const p2 of xs.filter((v) => v >= p)) {
						expect(fuzzyScore(d, p)).toBeGreaterThanOrEqual(fuzzyScore(d2, p2) - 1e-12);
					}
				}
			}
		}
	});
});

describe('rankNearby', () => {
	it('puts the nearest first when prices are equal', () => {
		const out = rankNearby([st('far', 4, 60), st('near', 0.5, 60), st('mid', 2, 60)]);
		expect(names(out)).toEqual(['near', 'mid', 'far']);
	});

	it('lets a much cheaper station a little further away win', () => {
		// in town: 2.5 km more for 20 kr/kWh less
		const out = rankNearby([st('near-dear', 0.5, 69), st('cheap', 3, 49)]);
		expect(names(out)).toEqual(['cheap', 'near-dear']);
	});

	it('keeps the near one when the cheaper one is too far', () => {
		const out = rankNearby([st('near-dear', 0.5, 69), st('cheap', 8, 49)]);
		expect(names(out)).toEqual(['near-dear', 'cheap']);
	});

	it('does not treat a small price difference as cheap vs expensive', () => {
		// 64 vs 66 kr is within the 20 % minimum spread: distance decides
		const out = rankNearby([st('a', 1.5, 64), st('b', 0.5, 66)]);
		expect(names(out)).toEqual(['b', 'a']);
	});

	it('sinks unknown prices well down the list without dropping them', () => {
		const out = rankNearby([
			st('unknown-next-door', 0.2, null),
			st('a', 1, 60),
			st('b', 2, 65),
			st('c', 3, 70)
		]);
		expect(names(out)).toEqual(['a', 'b', 'c', 'unknown-next-door']);
		expect(out).toHaveLength(4);
	});

	it('still puts a very near unknown-price station above a very far priced one', () => {
		const out = rankNearby([st('unknown', 0.3, null), st('far', 120, 50), st('ok', 1, 60)]);
		expect(names(out)).toEqual(['ok', 'unknown', 'far']);
	});

	it('scales distance to the candidates, so it works in the country too', () => {
		// no station within 20 km: the nearer one still wins at equal price
		const out = rankNearby([st('b', 60, 60), st('a', 25, 60), st('c', 110, 60)]);
		expect(names(out)).toEqual(['a', 'b', 'c']);
	});

	it('ranks only the nearest NEARBY_COUNT', () => {
		const rows = Array.from({ length: NEARBY_COUNT + 5 }, (_, i) => st(`s${i}`, i + 1, 60));
		const out = rankNearby(rows);
		expect(out).toHaveLength(NEARBY_COUNT);
		expect(out.some((r) => r.name === `s${NEARBY_COUNT}`)).toBe(false);
	});

	it('handles no prices at all, and an empty list', () => {
		expect(names(rankNearby([st('b', 2, null), st('a', 1, null)]))).toEqual(['a', 'b']);
		expect(rankNearby([])).toEqual([]);
	});
});
