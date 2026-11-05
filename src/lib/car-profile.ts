// Side-view silhouettes for the car search, drawn from each car's own data: its body
// style (OpenEV body.style) sets the shape of the roofline, and its length, height and
// wheelbase set the proportions. Every car is drawn at the same scale, so a Fiat
// Topolino reads small next to a Silverado. Front faces right.

export interface CarShape {
	bodyStyle: string | null;
	lengthMm: number | null;
	heightMm: number | null;
	wheelbaseMm: number | null;
}

export interface CarProfile {
	/** closed outline of the body */
	body: string;
	/** side windows, drawn over the body */
	glass: string;
	/** the B-pillar splitting the side windows, drawn over the glass; null for single-window cabs */
	pillar: { x: number; y: number; width: number; height: number } | null;
	wheels: { cx: number; cy: number; r: number }[];
}

/** viewBox units: 1 unit = 100 mm, so the box fits 6.4 m × 2.6 m */
export const PROFILE_WIDTH = 64;
export const PROFILE_HEIGHT = 26;
const MM_PER_UNIT = 100;

type Family =
	| 'sedan'
	| 'hatchback'
	| 'crossover'
	| 'suv'
	| 'coupe'
	| 'suv_coupe'
	| 'wagon'
	| 'convertible'
	| 'mpv'
	| 'van'
	| 'pickup'
	| 'micro';

const FAMILY: Record<string, Family> = {
	sedan: 'sedan',
	hatchback: 'hatchback',
	crossover: 'crossover',
	suv: 'suv',
	mini_suv: 'micro',
	coupe: 'coupe',
	fastback: 'coupe',
	suv_coupe: 'suv_coupe',
	shooting_brake: 'wagon',
	wagon: 'wagon',
	estate: 'wagon',
	convertible: 'convertible',
	mpv: 'mpv',
	minivan: 'mpv',
	van: 'van',
	pickup: 'pickup',
	quadricycle: 'micro'
};

/** typical size per family, for records without dimensions: [length, height, wheelbase] */
const TYPICAL: Record<Family, [number, number, number]> = {
	sedan: [4800, 1450, 2900],
	hatchback: [4200, 1550, 2650],
	crossover: [4600, 1620, 2800],
	suv: [4900, 1750, 2950],
	coupe: [4750, 1420, 2880],
	suv_coupe: [4800, 1600, 2900],
	wagon: [4900, 1500, 2950],
	convertible: [4700, 1360, 2800],
	mpv: [4800, 1840, 2950],
	van: [5300, 2050, 3300],
	pickup: [5700, 1930, 3600],
	micro: [3000, 1580, 2000]
};

/**
 * Outline per family, rear (x=0) to front (x=1), y as a fraction of the car's height
 * above the ground. The bottom edge (sill at ground clearance) closes the shape.
 * The third number is the corner rounding, as a fraction of the height.
 */
type Pt = [x: number, y: number, round?: number];

const OUTLINE: Record<Family, Pt[]> = {
	sedan: [
		[0, 0.3, 0.05],
		[0.01, 0.62, 0.06],
		[0.13, 0.69, 0.08],
		[0.35, 1, 0.2],
		[0.57, 1, 0.16],
		[0.74, 0.69, 0.1],
		[0.97, 0.6, 0.08],
		[1, 0.4, 0.1],
		[0.99, 0.2, 0.05]
	],
	hatchback: [
		[0, 0.3, 0.05],
		[0.01, 0.74, 0.08],
		[0.13, 1, 0.16],
		[0.57, 1, 0.16],
		[0.74, 0.65, 0.1],
		[0.97, 0.56, 0.08],
		[1, 0.38, 0.1],
		[0.99, 0.2, 0.05]
	],
	crossover: [
		[0, 0.32, 0.05],
		[0.01, 0.78, 0.08],
		[0.09, 1, 0.14],
		[0.62, 1, 0.16],
		[0.77, 0.68, 0.1],
		[0.98, 0.62, 0.08],
		[1, 0.4, 0.1],
		[0.99, 0.22, 0.05]
	],
	suv: [
		[0, 0.32, 0.04],
		[0.005, 0.84, 0.06],
		[0.05, 1, 0.1],
		[0.66, 1, 0.12],
		[0.78, 0.7, 0.08],
		[0.985, 0.66, 0.06],
		[1, 0.42, 0.08],
		[0.99, 0.22, 0.05]
	],
	coupe: [
		[0, 0.32, 0.05],
		[0.01, 0.6, 0.06],
		[0.1, 0.66, 0.1],
		[0.4, 1, 0.26],
		[0.56, 1, 0.16],
		[0.73, 0.66, 0.1],
		[0.97, 0.56, 0.08],
		[1, 0.38, 0.1],
		[0.99, 0.2, 0.05]
	],
	suv_coupe: [
		[0, 0.32, 0.05],
		[0.01, 0.68, 0.06],
		[0.09, 0.76, 0.1],
		[0.37, 1, 0.24],
		[0.6, 1, 0.16],
		[0.76, 0.68, 0.1],
		[0.98, 0.6, 0.08],
		[1, 0.4, 0.1],
		[0.99, 0.22, 0.05]
	],
	wagon: [
		[0, 0.3, 0.05],
		[0.01, 0.7, 0.06],
		[0.06, 0.96, 0.12],
		[0.56, 1, 0.16],
		[0.73, 0.67, 0.1],
		[0.97, 0.58, 0.08],
		[1, 0.4, 0.1],
		[0.99, 0.2, 0.05]
	],
	convertible: [
		[0, 0.34, 0.05],
		[0.01, 0.68, 0.06],
		[0.28, 0.76, 0.1],
		[0.42, 1, 0.12],
		[0.56, 1, 0.12],
		[0.7, 0.72, 0.08],
		[0.97, 0.6, 0.08],
		[1, 0.42, 0.1],
		[0.99, 0.2, 0.05]
	],
	mpv: [
		[0, 0.3, 0.04],
		[0.005, 0.88, 0.06],
		[0.04, 1, 0.08],
		[0.7, 1, 0.12],
		[0.87, 0.62, 0.1],
		[0.985, 0.54, 0.06],
		[1, 0.36, 0.08],
		[0.99, 0.2, 0.04]
	],
	van: [
		[0, 0.28, 0.03],
		[0, 0.96, 0.04],
		[0.02, 1, 0.05],
		[0.76, 1, 0.08],
		[0.88, 0.62, 0.08],
		[0.99, 0.52, 0.05],
		[1, 0.34, 0.06],
		[0.99, 0.18, 0.04]
	],
	pickup: [
		[0, 0.32, 0.03],
		[0, 0.66, 0.02],
		[0.36, 0.66, 0.02],
		[0.37, 1, 0.06],
		[0.6, 1, 0.1],
		[0.71, 0.72, 0.06],
		[0.985, 0.68, 0.05],
		[1, 0.44, 0.06],
		[0.99, 0.22, 0.04]
	],
	micro: [
		[0, 0.3, 0.06],
		[0.01, 0.8, 0.1],
		[0.08, 1, 0.16],
		[0.6, 1, 0.16],
		[0.8, 0.64, 0.12],
		[0.97, 0.56, 0.1],
		[1, 0.36, 0.12],
		[0.99, 0.2, 0.06]
	]
};

/** Side windows: the greenhouse outline inset from the body, same coordinates. */
const GLASS: Record<Family, Pt[]> = {
	sedan: [
		[0.18, 0.67, 0.04],
		[0.36, 0.93, 0.08],
		[0.56, 0.93, 0.06],
		[0.7, 0.67, 0.03]
	],
	hatchback: [
		[0.06, 0.7, 0.03],
		[0.15, 0.93, 0.06],
		[0.56, 0.93, 0.06],
		[0.7, 0.64, 0.03]
	],
	crossover: [
		[0.05, 0.72, 0.03],
		[0.11, 0.93, 0.06],
		[0.61, 0.93, 0.06],
		[0.73, 0.67, 0.03]
	],
	suv: [
		[0.03, 0.72, 0.03],
		[0.07, 0.93, 0.05],
		[0.65, 0.93, 0.05],
		[0.75, 0.69, 0.03]
	],
	coupe: [
		[0.2, 0.65, 0.04],
		[0.41, 0.93, 0.1],
		[0.55, 0.93, 0.06],
		[0.69, 0.65, 0.03]
	],
	suv_coupe: [
		[0.16, 0.69, 0.04],
		[0.38, 0.93, 0.1],
		[0.59, 0.93, 0.06],
		[0.72, 0.67, 0.03]
	],
	wagon: [
		[0.04, 0.67, 0.03],
		[0.08, 0.93, 0.05],
		[0.55, 0.93, 0.06],
		[0.69, 0.66, 0.03]
	],
	convertible: [
		[0.43, 0.75, 0.03],
		[0.44, 0.93, 0.04],
		[0.55, 0.93, 0.04],
		[0.66, 0.71, 0.03]
	],
	mpv: [
		[0.03, 0.63, 0.03],
		[0.05, 0.93, 0.05],
		[0.69, 0.93, 0.06],
		[0.83, 0.61, 0.03]
	],
	van: [
		[0.62, 0.63, 0.02],
		[0.62, 0.93, 0.02],
		[0.75, 0.93, 0.04],
		[0.85, 0.61, 0.02]
	],
	pickup: [
		[0.4, 0.69, 0.02],
		[0.4, 0.93, 0.03],
		[0.59, 0.93, 0.05],
		[0.68, 0.71, 0.02]
	],
	micro: [
		[0.06, 0.63, 0.03],
		[0.1, 0.93, 0.06],
		[0.59, 0.93, 0.06],
		[0.76, 0.63, 0.03]
	]
};

/** where the B-pillar sits, as a fraction of the length; null = one side window */
const PILLAR: Record<Family, number | null> = {
	sedan: 0.47,
	hatchback: 0.4,
	crossover: 0.42,
	suv: 0.44,
	coupe: null,
	suv_coupe: 0.48,
	wagon: 0.4,
	convertible: null,
	mpv: 0.44,
	van: null,
	pickup: 0.5,
	micro: null
};

/** ground clearance and wheel size, as fractions of the car's height */
const STANCE: Record<Family, { sill: number; wheel: number }> = {
	sedan: { sill: 0.1, wheel: 0.46 },
	hatchback: { sill: 0.1, wheel: 0.42 },
	crossover: { sill: 0.11, wheel: 0.44 },
	suv: { sill: 0.12, wheel: 0.45 },
	coupe: { sill: 0.09, wheel: 0.48 },
	suv_coupe: { sill: 0.11, wheel: 0.45 },
	wagon: { sill: 0.1, wheel: 0.46 },
	convertible: { sill: 0.09, wheel: 0.5 },
	mpv: { sill: 0.09, wheel: 0.37 },
	van: { sill: 0.08, wheel: 0.33 },
	pickup: { sill: 0.13, wheel: 0.44 },
	micro: { sill: 0.09, wheel: 0.36 }
};

export function carFamily(bodyStyle: string | null): Family {
	return (bodyStyle && FAMILY[bodyStyle]) || 'crossover';
}

/** The car's [length, height, wheelbase] in mm, falling back to the family's typical size. */
export function carSize(car: CarShape): [number, number, number] {
	const [tl, th, tw] = TYPICAL[carFamily(car.bodyStyle)];
	const sane = (v: number | null, lo: number, hi: number) =>
		v !== null && v >= lo && v <= hi ? v : null;
	const length = sane(car.lengthMm, 2000, 6400);
	const height = sane(car.heightMm, 1000, 2600);
	// a wheelbase is only usable alongside the length it belongs to
	const wheelbase = length ? sane(car.wheelbaseMm, length * 0.45, length * 0.8) : null;
	if (!length) return [tl, height ?? th, tw];
	return [length, height ?? th, wheelbase ?? length * (tw / tl)];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Closed path through the points, each corner cut by a quadratic curve of its radius. */
function roundedPath(pts: { x: number; y: number; r: number }[]): string {
	const n = pts.length;
	let d = '';
	for (let i = 0; i < n; i++) {
		const p = pts[i];
		const a = pts[(i - 1 + n) % n];
		const b = pts[(i + 1) % n];
		const toward = (q: { x: number; y: number }) => {
			const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
			const k = Math.min(p.r, len / 2) / len;
			return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
		};
		const p1 = toward(a);
		const p2 = toward(b);
		d += `${i === 0 ? 'M' : 'L'}${r2(p1.x)} ${r2(p1.y)}Q${r2(p.x)} ${r2(p.y)} ${r2(p2.x)} ${r2(p2.y)}`;
	}
	return d + 'Z';
}

export function carProfile(car: CarShape): CarProfile {
	const family = carFamily(car.bodyStyle);
	const [lengthMm, heightMm, wheelbaseMm] = carSize(car);
	const length = lengthMm / MM_PER_UNIT;
	const height = heightMm / MM_PER_UNIT;
	const wheelbase = wheelbaseMm / MM_PER_UNIT;
	const { sill, wheel } = STANCE[family];

	// centred horizontally, standing on the bottom edge
	const x0 = (PROFILE_WIDTH - length) / 2;
	const ground = PROFILE_HEIGHT - 0.5;
	const at = ([fx, fy, round = 0]: Pt) => ({
		x: x0 + fx * length,
		y: ground - fy * height,
		r: round * height
	});

	const outline = OUTLINE[family].map(at);
	// the sill closes the outline between the rear and front bumpers
	outline.push(
		{ x: x0 + 0.99 * length, y: ground - sill * height, r: 0.05 * height },
		{ x: x0 + 0.01 * length, y: ground - sill * height, r: 0.05 * height }
	);

	// EVs carry a slightly longer front overhang than rear
	const rearOverhang = (length - wheelbase) * 0.46;
	const radius = (wheel * height) / 2;
	const cy = ground - radius;
	const wheels = [x0 + rearOverhang, x0 + rearOverhang + wheelbase].map((cx) => ({
		cx: r2(cx),
		cy: r2(cy),
		r: r2(radius)
	}));

	const glass = GLASS[family].map(at);
	const pillarAt = PILLAR[family];
	const pillarWidth = 0.7;
	const pillar =
		pillarAt === null
			? null
			: {
					x: r2(x0 + pillarAt * length - pillarWidth / 2),
					y: r2(Math.min(...glass.map((p) => p.y)) - 0.2),
					width: pillarWidth,
					height: r2(Math.max(...glass.map((p) => p.y)) - Math.min(...glass.map((p) => p.y)) + 0.4)
				};

	return { body: roundedPath(outline), glass: roundedPath(glass), pillar, wheels };
}
