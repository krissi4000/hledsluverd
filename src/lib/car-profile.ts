// Side-view silhouettes for the car search. The shape of each model comes from its entry
// in car-shapes.ts (roofline, tail, bonnet, pillars…), the proportions from its real
// length, height and wheelbase. Every car is drawn at the same scale, so a Fiat Topolino
// reads small next to an E-Transit. Front faces right.

import { carMakeKey } from './car-key';
import {
	MODEL_SHAPES,
	PRESETS,
	STYLE_PRESET,
	TYPICAL_SIZE,
	type Preset,
	type Shape,
	type XY
} from './car-shapes';

export interface CarShape {
	make: string;
	model: string;
	bodyStyle: string | null;
	lengthMm: number | null;
	heightMm: number | null;
	wheelbaseMm: number | null;
}

export interface Circle {
	cx: number;
	cy: number;
	r: number;
}

export interface CarProfile {
	/** closed outline of the body */
	body: string;
	/** side windows, drawn over the body */
	glass: string;
	/** pillars splitting the side windows, drawn over the glass */
	pillars: { x: number; y: number; width: number; height: number }[];
	wheels: Circle[];
	/** a spare wheel on the tailgate, if the car carries one */
	spare: Circle | null;
}

/** viewBox units: 1 unit = 100 mm, so the box fits 5.6 m × 2.6 m (the longest car, an E-Transit, is 5.53 m) */
export const PROFILE_WIDTH = 56;
export const PROFILE_HEIGHT = 26;
const MM_PER_UNIT = 100;
const GROUND = PROFILE_HEIGHT - 0.5;

export function modelKey(make: string, model: string): string {
	return `${carMakeKey(make)}/${carMakeKey(model)}`;
}

/** The shape for a car: its own model entry, else the preset for its body style. */
export function carShape(car: Pick<CarShape, 'make' | 'model' | 'bodyStyle'>): {
	shape: Shape;
	preset: Preset;
	size: [number, number, number] | null;
} {
	const entry = MODEL_SHAPES[modelKey(car.make, car.model)];
	if (entry) {
		const { base, size, ...overrides } = entry;
		return { shape: { ...PRESETS[base], ...overrides }, preset: base, size: size ?? null };
	}
	const preset = (car.bodyStyle && STYLE_PRESET[car.bodyStyle]) || 'crossover';
	return { shape: PRESETS[preset], preset, size: null };
}

/**
 * The car's [length, height, wheelbase] in mm: a curated size from its model entry, else
 * the dataset's dimensions when plausible, else the preset's typical size.
 */
export function carSize(car: CarShape): [number, number, number] {
	const { preset, size } = carShape(car);
	if (size) return size;
	const [tl, th, tw] = TYPICAL_SIZE[preset];
	const sane = (v: number | null, lo: number, hi: number) =>
		v !== null && v >= lo && v <= hi ? v : null;
	const length = sane(car.lengthMm, 2000, PROFILE_WIDTH * MM_PER_UNIT - 50);
	const height = sane(car.heightMm, 1000, 2600);
	// a wheelbase is only usable alongside the length it belongs to
	const wheelbase = length ? sane(car.wheelbaseMm, length * 0.45, length * 0.8) : null;
	if (!length) return [tl, height ?? th, tw];
	return [length, height ?? th, wheelbase ?? length * (tw / tl)];
}

interface P {
	x: number;
	y: number;
}
interface RP extends P {
	r: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Closed path through the points, each corner cut by a quadratic curve of its radius. */
function roundedPath(pts: RP[]): string {
	const n = pts.length;
	let d = '';
	for (let i = 0; i < n; i++) {
		const p = pts[i];
		const toward = (q: P) => {
			const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
			const k = Math.min(p.r, len / 2) / len;
			return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
		};
		const p1 = toward(pts[(i - 1 + n) % n]);
		const p2 = toward(pts[(i + 1) % n]);
		d += `${i === 0 ? 'M' : 'L'}${r2(p1.x)} ${r2(p1.y)}Q${r2(p.x)} ${r2(p.y)} ${r2(p2.x)} ${r2(p2.y)}`;
	}
	return d + 'Z';
}

/** Point on the quadratic roof curve from a to b, its middle lifted by `crown`. */
function roofAt(a: XY, b: XY, crown: number, t: number): XY {
	const c: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + crown];
	const u = 1 - t;
	return [
		u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
		u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]
	];
}

/** x where the line through a and b reaches height y (extended past its ends if needed) */
function xAtY(a: P, b: P, y: number): number {
	if (Math.abs(b.y - a.y) < 1e-9) return a.x;
	return a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
}

/**
 * Shrinks a convex polygon by moving each edge inwards by its own distance and
 * re-intersecting neighbours. Points are in y-up space.
 */
function inset(poly: P[], offsets: number[]): P[] {
	const n = poly.length;
	const cx = poly.reduce((s, p) => s + p.x, 0) / n;
	const cy = poly.reduce((s, p) => s + p.y, 0) / n;
	const lines = poly.map((a, i) => {
		const b = poly[(i + 1) % n];
		const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
		const dx = (b.x - a.x) / len;
		const dy = (b.y - a.y) / len;
		let nx = -dy;
		let ny = dx;
		// point the normal at the centroid
		if ((cx - a.x) * nx + (cy - a.y) * ny < 0) {
			nx = -nx;
			ny = -ny;
		}
		return { x: a.x + nx * offsets[i], y: a.y + ny * offsets[i], dx, dy, nx, ny };
	});
	return lines.map((l1, i) => {
		const l0 = lines[(i - 1 + n) % n];
		const cross = l0.dx * l1.dy - l0.dy * l1.dx;
		if (Math.abs(cross) < 1e-6) return { x: l1.x, y: l1.y };
		const t = ((l1.x - l0.x) * l1.dy - (l1.y - l0.y) * l1.dx) / cross;
		return { x: l0.x + l0.dx * t, y: l0.y + l0.dy * t };
	});
}

/** The part of a polygon at or ahead of x = c (one Sutherland–Hodgman pass). */
function clipFrom(poly: P[], c: number): P[] {
	const out: P[] = [];
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		if (a.x >= c) out.push(a);
		if (a.x >= c !== b.x >= c) out.push({ x: c, y: a.y + ((c - a.x) * (b.y - a.y)) / (b.x - a.x) });
	}
	return out;
}

/** Highest point of the polygon's outline at x (y-up), or null if x misses it. */
function topAt(poly: P[], x: number): number | null {
	let top: number | null = null;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		if ((x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) && a.x !== b.x) continue;
		const y = a.x === b.x ? Math.max(a.y, b.y) : a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
		if (top === null || y > top) top = y;
	}
	return top;
}

export function carProfile(car: CarShape): CarProfile {
	const { shape: s } = carShape(car);
	const [lengthMm, heightMm, wheelbaseMm] = carSize(car);
	const L = lengthMm / MM_PER_UNIT;
	const H = heightMm / MM_PER_UNIT;
	const WB = wheelbaseMm / MM_PER_UNIT;
	const x0 = (PROFILE_WIDTH - L) / 2;

	// the roof as a run of points, so its arch survives the corner rounding
	const roof: XY[] = [0.2, 0.4, 0.6, 0.8].map((t) => roofAt(s.roofRear, s.roofFront, s.crown, t));
	// scale heights so the highest point of the drawing is exactly the car's height
	const top = Math.max(s.roofRear[1], s.roofFront[1], ...roof.map((p) => p[1]));
	const fy = (y: number) => y / top;

	// y-up coordinates in viewBox units, origin at the rear bumper on the ground
	const pt = ([x, y]: XY, r = 0): RP => ({ x: x * L, y: fy(y) * H, r: r * H * s.round });
	const outline: RP[] = [
		pt([0, s.tailBottom], 0.05),
		pt(s.tail, 0.06),
		...(s.deck ? [pt(s.deck, 0.08)] : []),
		pt(s.roofRear, 0.12),
		...roof.map((p) => pt(p)),
		pt(s.roofFront, 0.1),
		pt(s.cowl, 0.06),
		pt(s.hood, 0.08),
		pt([1, s.nose], 0.1),
		pt([0.99, s.noseBottom], 0.05),
		pt([0.985, s.sill], 0.04),
		pt([0.015, s.sill], 0.04)
	];

	// side glass: the greenhouse between the beltline and the roof, inset from the body
	const belt = fy(s.belt) * H;
	const rearLow = pt(s.deck ?? s.tail);
	const rearTop = pt(s.roofRear);
	const frontTop = pt(s.roofFront);
	const cowl = pt(s.cowl);
	const tailX = pt(s.tail).x;
	const house: P[] = [
		{ x: Math.max(xAtY(rearTop, rearLow, belt), tailX), y: belt },
		rearTop,
		...roof.map((p) => pt(p)),
		frontTop,
		{ x: xAtY(frontTop, cowl, belt), y: belt }
	];
	const gap = 0.06 * H;
	const offsets = house.map((_, i) =>
		i === 0 ? gap + s.dPillar * L : i === house.length - 1 ? 0.02 * H : gap
	);
	let glass = inset(house, offsets);
	if (s.glassFrom !== null) glass = clipFrom(glass, s.glassFrom * L);

	const toView = (p: P): P => ({ x: x0 + p.x, y: GROUND - p.y });
	const view = (p: RP): RP => ({ ...toView(p), r: p.r });

	const pillarWidth = 0.065 * H;
	const pillars = s.pillars.flatMap((px) => {
		const x = px * L;
		const t = topAt(glass, x);
		if (t === null || t <= belt) return [];
		return [
			{
				x: r2(x0 + x - pillarWidth / 2),
				y: r2(GROUND - t - 0.3),
				width: r2(pillarWidth),
				height: r2(t - belt + 0.6)
			}
		];
	});

	const radius = (s.wheel * H) / 2;
	const rearAxle = (L - WB) * s.rearShare;
	const wheels = [rearAxle, rearAxle + WB].map((x) => ({
		cx: r2(x0 + x),
		cy: r2(GROUND - radius),
		r: r2(radius)
	}));
	const spare = s.spare
		? { cx: r2(x0 + 0.01 * L), cy: r2(GROUND - 0.5 * H), r: r2(0.2 * H) }
		: null;

	return {
		body: roundedPath(outline.map(view)),
		glass: roundedPath(glass.map((p) => ({ ...toView(p), r: 0.03 * H }))),
		pillars,
		wheels,
		spare
	};
}
