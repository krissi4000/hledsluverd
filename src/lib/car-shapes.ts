// What each car looks like from the side, for the car search silhouettes (car-profile.ts).
//
// A shape is a handful of silhouette landmarks. x runs from the rear bumper (0) to the
// front bumper (1); y is the height above the ground as a fraction of the car's height.
// Each model starts from a preset close to its body type and overrides what makes it
// recognisable: where the roof starts and ends, how much it arches, how long the hood is,
// how upright the tail is. Models missing here fall back to a preset for their body style.

export type XY = readonly [x: number, y: number];

export interface Shape {
	/** rear bumper bottom */
	tailBottom: number;
	/** top of the rear end: boot lid edge, spoiler lip or tailgate top */
	tail: XY;
	/** base of the rear window, for cars with a separate boot deck; null = rear line runs straight to `tail` */
	deck: XY | null;
	/** where the roof starts at the back (top of the rear window) */
	roofRear: XY;
	/** top of the windscreen */
	roofFront: XY;
	/** how far the roof arches above the straight line between its ends */
	crown: number;
	/** base of the windscreen */
	cowl: XY;
	/** front edge of the bonnet */
	hood: XY;
	/** height of the bumper tip at the very front */
	nose: number;
	noseBottom: number;
	/** body bottom between the wheels */
	sill: number;
	/** bottom edge of the side windows */
	belt: number;
	/** extra thickness of the rearmost pillar, as a fraction of the length */
	dPillar: number;
	/** x of the pillars splitting the side glass (B, and C on six-window cars) */
	pillars: number[];
	/** wheel diameter */
	wheel: number;
	/** share of the overhang that sits behind the rear axle */
	rearShare: number;
	/** multiplies every corner radius: >1 bubbly, <1 boxy */
	round: number;
	/** side glass only from this x forward: the solid load box of a cargo van, or the engine cover of a mid-engined car */
	glassFrom: number | null;
	/** a spare wheel hung on the tailgate */
	spare: boolean;
}

const sedan: Shape = {
	tailBottom: 0.3,
	tail: [0.01, 0.62],
	deck: [0.13, 0.68],
	roofRear: [0.33, 0.97],
	roofFront: [0.58, 0.97],
	crown: 0.04,
	cowl: [0.73, 0.67],
	hood: [0.965, 0.59],
	nose: 0.42,
	noseBottom: 0.2,
	sill: 0.1,
	belt: 0.64,
	dPillar: 0.02,
	pillars: [0.47],
	wheel: 0.46,
	rearShare: 0.46,
	round: 1,
	glassFrom: null,
	spare: false
};

export const PRESETS = {
	sedan,
	/** arched one-bow saloon with a short boot (Model 3, Ioniq 6, EQE) */
	fastsedan: {
		...sedan,
		tail: [0.005, 0.58],
		deck: [0.08, 0.63],
		roofRear: [0.29, 0.93],
		roofFront: [0.6, 0.95],
		crown: 0.08,
		cowl: [0.74, 0.62],
		hood: [0.97, 0.53],
		nose: 0.38,
		belt: 0.6,
		pillars: [0.46]
	},
	/** sloping liftback / sportback (Model S, i4, ID.7) */
	liftback: {
		...sedan,
		tail: [0.005, 0.6],
		deck: [0.05, 0.64],
		roofRear: [0.36, 0.96],
		roofFront: [0.59, 0.97],
		crown: 0.04,
		cowl: [0.73, 0.63],
		hood: [0.97, 0.54],
		nose: 0.38,
		belt: 0.61,
		pillars: [0.48]
	},
	hatch: {
		...sedan,
		tail: [0.01, 0.73],
		deck: null,
		roofRear: [0.1, 0.97],
		roofFront: [0.57, 0.98],
		crown: 0.03,
		cowl: [0.72, 0.62],
		hood: [0.965, 0.55],
		nose: 0.38,
		belt: 0.6,
		dPillar: 0.05,
		pillars: [0.42],
		wheel: 0.44
	},
	crossover: {
		...sedan,
		tailBottom: 0.32,
		tail: [0.01, 0.76],
		deck: null,
		roofRear: [0.08, 0.97],
		roofFront: [0.6, 0.98],
		crown: 0.02,
		cowl: [0.75, 0.66],
		hood: [0.97, 0.6],
		nose: 0.42,
		noseBottom: 0.22,
		sill: 0.13,
		belt: 0.62,
		dPillar: 0.06,
		pillars: [0.43],
		wheel: 0.46
	},
	/** upright, square SUV */
	suv: {
		...sedan,
		tailBottom: 0.32,
		tail: [0.004, 0.83],
		deck: null,
		roofRear: [0.04, 0.99],
		roofFront: [0.65, 1],
		crown: 0.01,
		cowl: [0.78, 0.68],
		hood: [0.985, 0.66],
		nose: 0.48,
		noseBottom: 0.22,
		sill: 0.14,
		belt: 0.62,
		dPillar: 0.05,
		pillars: [0.44],
		wheel: 0.47,
		round: 0.8
	},
	/** crossover with a coupé roofline */
	coupesuv: {
		...sedan,
		tailBottom: 0.32,
		tail: [0.008, 0.66],
		deck: [0.06, 0.7],
		roofRear: [0.34, 0.97],
		roofFront: [0.6, 0.99],
		crown: 0.05,
		cowl: [0.75, 0.65],
		hood: [0.97, 0.59],
		nose: 0.42,
		noseBottom: 0.22,
		sill: 0.13,
		belt: 0.62,
		pillars: [0.46],
		wheel: 0.47
	},
	wagon: {
		...sedan,
		tail: [0.01, 0.7],
		deck: null,
		roofRear: [0.06, 0.94],
		roofFront: [0.58, 0.99],
		crown: 0.02,
		cowl: [0.73, 0.63],
		hood: [0.97, 0.55],
		nose: 0.38,
		belt: 0.61,
		dPillar: 0.04,
		pillars: [0.43]
	},
	mpv: {
		...sedan,
		tailBottom: 0.28,
		tail: [0.003, 0.88],
		deck: null,
		roofRear: [0.03, 1],
		roofFront: [0.72, 1],
		crown: 0.01,
		cowl: [0.87, 0.62],
		hood: [0.985, 0.54],
		nose: 0.38,
		noseBottom: 0.18,
		sill: 0.09,
		belt: 0.56,
		dPillar: 0.03,
		pillars: [0.5, 0.25],
		wheel: 0.37,
		rearShare: 0.44
	},
	/** cargo van: glass only in the cab */
	van: {
		...sedan,
		tailBottom: 0.26,
		tail: [0, 0.96],
		deck: null,
		roofRear: [0.01, 1],
		roofFront: [0.76, 1],
		crown: 0,
		cowl: [0.88, 0.6],
		hood: [0.99, 0.5],
		nose: 0.34,
		noseBottom: 0.16,
		sill: 0.08,
		belt: 0.55,
		dPillar: 0,
		pillars: [],
		wheel: 0.33,
		rearShare: 0.4,
		round: 0.7,
		glassFrom: 0.66
	},
	/** mid-engined sports car: cab forward, long sloping engine cover */
	mid: {
		...sedan,
		tailBottom: 0.36,
		tail: [0, 0.62],
		deck: [0.08, 0.68],
		roofRear: [0.4, 0.99],
		roofFront: [0.56, 1],
		crown: 0.04,
		cowl: [0.73, 0.56],
		hood: [0.97, 0.42],
		nose: 0.32,
		noseBottom: 0.14,
		sill: 0.1,
		belt: 0.62,
		dPillar: 0,
		pillars: [],
		wheel: 0.56,
		rearShare: 0.5,
		glassFrom: 0.43
	},
	/** front-engined grand tourer: long bonnet, cab set back */
	gt: {
		...sedan,
		tail: [0.005, 0.6],
		deck: [0.07, 0.65],
		roofRear: [0.3, 0.97],
		roofFront: [0.52, 0.99],
		crown: 0.05,
		cowl: [0.66, 0.64],
		hood: [0.97, 0.54],
		nose: 0.38,
		belt: 0.62,
		pillars: [],
		wheel: 0.5
	},
	/** open two-seater: low windscreen, no roof */
	roadster: {
		...sedan,
		tail: [0.005, 0.64],
		deck: [0.2, 0.7],
		roofRear: [0.4, 0.9],
		roofFront: [0.54, 0.97],
		crown: 0.02,
		cowl: [0.64, 0.64],
		hood: [0.97, 0.52],
		nose: 0.38,
		belt: 0.7,
		dPillar: 0.02,
		pillars: [],
		wheel: 0.52
	},
	/** city car / bubble */
	micro: {
		...sedan,
		tail: [0, 0.76],
		deck: null,
		roofRear: [0.08, 0.97],
		roofFront: [0.58, 0.98],
		crown: 0.05,
		cowl: [0.76, 0.63],
		hood: [0.97, 0.55],
		nose: 0.4,
		noseBottom: 0.2,
		sill: 0.1,
		belt: 0.58,
		dPillar: 0.04,
		pillars: [0.42],
		wheel: 0.4,
		rearShare: 0.5,
		round: 1.5
	}
} satisfies Record<string, Shape>;

export type Preset = keyof typeof PRESETS;

/** typical [length, height, wheelbase] per preset, for cars without dimensions */
export const TYPICAL_SIZE: Record<Preset, [number, number, number]> = {
	sedan: [4900, 1460, 2950],
	fastsedan: [4800, 1460, 2900],
	liftback: [4900, 1440, 2950],
	hatch: [4200, 1550, 2650],
	crossover: [4600, 1620, 2800],
	suv: [4900, 1750, 2950],
	coupesuv: [4700, 1600, 2850],
	wagon: [4900, 1500, 2950],
	mpv: [4800, 1840, 2950],
	van: [5300, 2050, 3300],
	mid: [4600, 1200, 2650],
	gt: [4950, 1380, 2930],
	roadster: [4500, 1300, 2600],
	micro: [3200, 1550, 2100]
};

/** OpenEV body.style → preset, for models without their own entry */
export const STYLE_PRESET: Record<string, Preset> = {
	sedan: 'sedan',
	hatchback: 'hatch',
	crossover: 'crossover',
	suv: 'suv',
	mini_suv: 'micro',
	coupe: 'gt',
	fastback: 'liftback',
	suv_coupe: 'coupesuv',
	shooting_brake: 'wagon',
	wagon: 'wagon',
	estate: 'wagon',
	convertible: 'roadster',
	mpv: 'mpv',
	minivan: 'mpv',
	van: 'van',
	quadricycle: 'micro'
};

export interface ModelShape extends Partial<Shape> {
	base: Preset;
	/** [length, height, wheelbase] in mm, for models the dataset has no (or wrong) dimensions for */
	size?: [number, number, number];
}

/** Keyed by `${carMakeKey(make)}/${carMakeKey(model)}`. */
export const MODEL_SHAPES: Record<string, ModelShape> = {
	// Audi
	'audi/a6-e-tron': { base: 'liftback', roofRear: [0.34, 0.96], deck: [0.06, 0.65] },
	'audi/e-tron-gt': {
		base: 'liftback',
		roofRear: [0.37, 0.95],
		roofFront: [0.58, 0.98],
		cowl: [0.71, 0.6],
		hood: [0.97, 0.49],
		nose: 0.35,
		wheel: 0.52
	},
	'audi/q4-e-tron': { base: 'crossover', tail: [0.01, 0.74], roofRear: [0.09, 0.96] },
	'audi/q6-e-tron': {
		base: 'crossover',
		tail: [0.01, 0.72],
		roofRear: [0.11, 0.95],
		crown: 0.03,
		wheel: 0.48
	},
	'audi/q8-e-tron': { base: 'crossover', roofRear: [0.07, 0.97], cowl: [0.76, 0.66] },
	'automobili-pininfarina/battista': {
		base: 'mid',
		size: [4912, 1214, 2795],
		roofRear: [0.42, 0.98]
	},
	// BMW
	'bmw/i4': {
		base: 'liftback',
		roofRear: [0.34, 0.96],
		cowl: [0.71, 0.63],
		hood: [0.97, 0.56],
		nose: 0.42
	},
	'bmw/i5': { base: 'sedan', hood: [0.97, 0.6] },
	'bmw/i7': {
		base: 'sedan',
		deck: [0.13, 0.7],
		roofRear: [0.31, 0.98],
		roofFront: [0.6, 0.98],
		cowl: [0.74, 0.7],
		hood: [0.975, 0.66],
		nose: 0.48,
		belt: 0.66,
		pillars: [0.48]
	},
	'bmw/ix': {
		base: 'suv',
		tail: [0.006, 0.78],
		roofRear: [0.06, 0.97],
		crown: 0.03,
		round: 1.1,
		wheel: 0.5
	},
	'bmw/ix1': { base: 'suv', tail: [0.005, 0.8], roofRear: [0.05, 0.98] },
	'bmw/ix2': { base: 'coupesuv', roofRear: [0.32, 0.97], deck: [0.05, 0.72] },
	'bmw/ix3': { base: 'suv', tail: [0.006, 0.8], cowl: [0.77, 0.67], hood: [0.98, 0.63] },
	// BYD
	'byd/dolphin': { base: 'hatch', tail: [0.01, 0.74], roofRear: [0.11, 0.97] },
	'byd/han': { base: 'fastsedan', roofRear: [0.3, 0.95], deck: [0.09, 0.64] },
	'byd/seal': {
		base: 'fastsedan',
		tail: [0.004, 0.57],
		deck: [0.06, 0.61],
		roofRear: [0.29, 0.93],
		crown: 0.08,
		hood: [0.97, 0.5],
		nose: 0.35
	},
	'byd/song-plus': { base: 'crossover', tail: [0.01, 0.74], roofRear: [0.09, 0.96] },
	'byd/tang': { base: 'suv', tail: [0.005, 0.8], roofRear: [0.05, 0.97] },
	'byd/yuan-plus': { base: 'crossover', tail: [0.01, 0.74], roofRear: [0.1, 0.96] },
	// Citroën
	'citroen/e-berlingo': { base: 'mpv', cowl: [0.83, 0.64], hood: [0.98, 0.56] },
	'citroen/e-c3': {
		base: 'hatch',
		tail: [0.004, 0.78],
		roofRear: [0.07, 0.98],
		sill: 0.13,
		belt: 0.62,
		cowl: [0.73, 0.66],
		hood: [0.97, 0.6],
		round: 0.9
	},
	'citroen/e-c4': {
		base: 'coupesuv',
		tail: [0.008, 0.66],
		deck: [0.04, 0.7],
		roofRear: [0.28, 0.97],
		pillars: [0.45]
	},
	'citroen/e-c4-x': {
		base: 'sedan',
		tail: [0.01, 0.64],
		deck: [0.09, 0.68],
		roofRear: [0.34, 0.97],
		sill: 0.12
	},
	'citroen/e-jumpy': { base: 'van', cowl: [0.86, 0.6], hood: [0.985, 0.52], wheel: 0.36 },
	'citroen/e-spacetourer': {
		base: 'mpv',
		cowl: [0.86, 0.6],
		hood: [0.985, 0.52],
		tail: [0, 0.94],
		roofRear: [0.015, 1],
		round: 0.7
	},
	// Cupra
	'cupra/born': {
		base: 'hatch',
		tail: [0.01, 0.73],
		roofRear: [0.1, 0.96],
		roofFront: [0.57, 0.98],
		wheel: 0.47
	},
	'cupra/raval': { base: 'hatch', tail: [0.01, 0.74], roofRear: [0.12, 0.96], wheel: 0.46 },
	'cupra/tavascan': { base: 'coupesuv', roofRear: [0.3, 0.96], deck: [0.05, 0.69], wheel: 0.5 },
	'dacia/spring': {
		base: 'crossover',
		tail: [0.004, 0.78],
		roofRear: [0.07, 0.98],
		cowl: [0.74, 0.64],
		hood: [0.97, 0.58],
		wheel: 0.4,
		round: 0.9
	},
	// DS
	'ds-automobiles/ds-3-e-tense': {
		base: 'crossover',
		size: [4118, 1534, 2558],
		tail: [0.01, 0.74],
		roofRear: [0.1, 0.96]
	},
	'ds-automobiles/ds-4-e-tense': {
		base: 'hatch',
		size: [4400, 1490, 2675],
		tail: [0.01, 0.68],
		roofRear: [0.16, 0.96],
		wheel: 0.48
	},
	// Ferrari
	'ferrari/296-gtb': { base: 'mid', size: [4565, 1187, 2600] },
	'ferrari/sf90-spider': {
		base: 'mid',
		size: [4704, 1191, 2650],
		roofRear: [0.42, 0.95],
		roofFront: [0.55, 0.98]
	},
	'ferrari/sf90-stradale': { base: 'mid', size: [4710, 1186, 2650] },
	// Fiat
	'fiat/500e': {
		base: 'micro',
		tail: [0, 0.74],
		roofRear: [0.09, 0.97],
		roofFront: [0.6, 0.98],
		crown: 0.06,
		round: 1.8
	},
	'fiat/600e': {
		base: 'crossover',
		tail: [0.006, 0.74],
		roofRear: [0.09, 0.96],
		crown: 0.04,
		round: 1.4
	},
	'fiat/topolino': {
		base: 'micro',
		tail: [0, 0.8],
		roofRear: [0.1, 1],
		roofFront: [0.62, 1],
		crown: 0.02,
		cowl: [0.8, 0.66],
		hood: [0.97, 0.56],
		belt: 0.56,
		pillars: [],
		wheel: 0.33,
		round: 1.6
	},
	// Ford
	'ford/capri-ev': {
		base: 'coupesuv',
		size: [4634, 1626, 2767],
		roofRear: [0.32, 0.97],
		deck: [0.05, 0.7]
	},
	'ford/e-tourneo-courier': { base: 'mpv', size: [4337, 1830, 2700], cowl: [0.82, 0.64] },
	'ford/e-transit': { base: 'van', size: [5531, 2500, 3300], glassFrom: 0.7 },
	'ford/e-transit-courier': {
		base: 'van',
		size: [4337, 1840, 2700],
		cowl: [0.82, 0.62],
		hood: [0.98, 0.55],
		glassFrom: 0.6,
		wheel: 0.38
	},
	'ford/explorer-ev': {
		base: 'suv',
		size: [4468, 1630, 2767],
		tail: [0.005, 0.8],
		roofRear: [0.06, 0.97]
	},
	'ford/puma-gen-e': {
		base: 'crossover',
		size: [4207, 1555, 2588],
		tail: [0.01, 0.72],
		roofRear: [0.12, 0.96],
		crown: 0.04
	},
	// GAC Aion
	'gac-aion/aion-es': { base: 'sedan', roofRear: [0.31, 0.97], crown: 0.05 },
	'gac-aion/aion-v': { base: 'suv', tail: [0.005, 0.82] },
	'gac-aion/aion-y': { base: 'crossover', tail: [0.006, 0.8], roofRear: [0.07, 0.98] },
	// GWM — the round-roofed ORA 03 "Funky Cat"
	'gwm/ora-03-gt': {
		base: 'hatch',
		tail: [0.004, 0.68],
		roofRear: [0.14, 0.94],
		roofFront: [0.58, 0.96],
		crown: 0.08,
		round: 1.6
	},
	'gwm/ora-03-skin': {
		base: 'hatch',
		tail: [0.004, 0.68],
		roofRear: [0.14, 0.94],
		roofFront: [0.58, 0.96],
		crown: 0.08,
		round: 1.6
	},
	// Hyundai
	'hyundai/ioniq-5': {
		base: 'crossover',
		tail: [0, 0.8],
		roofRear: [0.05, 0.99],
		roofFront: [0.62, 1],
		crown: 0,
		cowl: [0.76, 0.65],
		hood: [0.98, 0.6],
		pillars: [0.45],
		wheel: 0.5,
		round: 0.5
	},
	'hyundai/ioniq-6': {
		base: 'fastsedan',
		tail: [0, 0.6],
		deck: [0.04, 0.63],
		roofRear: [0.2, 0.86],
		roofFront: [0.56, 0.96],
		crown: 0.12,
		cowl: [0.72, 0.6],
		hood: [0.97, 0.52],
		nose: 0.36,
		pillars: [0.44]
	},
	'hyundai/ioniq-9': {
		base: 'suv',
		tail: [0.004, 0.8],
		roofRear: [0.06, 0.97],
		crown: 0.02,
		round: 1.2,
		pillars: [0.47, 0.25]
	},
	'hyundai/kona-electric': { base: 'crossover', tail: [0.008, 0.74], roofRear: [0.1, 0.97] },
	'jaguar/i-pace': {
		base: 'coupesuv',
		size: [4682, 1566, 2990],
		tail: [0, 0.66],
		deck: [0.04, 0.7],
		roofRear: [0.28, 0.97],
		roofFront: [0.63, 0.99],
		cowl: [0.79, 0.63],
		hood: [0.975, 0.58],
		wheel: 0.5
	},
	// Land Rover
	'land-rover/range-rover-evoque-phev': {
		base: 'crossover',
		size: [4371, 1649, 2681],
		tail: [0.004, 0.78],
		roofRear: [0.06, 0.94],
		roofFront: [0.62, 1],
		belt: 0.66,
		round: 0.8
	},
	'land-rover/range-rover-phev': {
		base: 'suv',
		size: [5052, 1870, 2997],
		tail: [0, 0.86],
		cowl: [0.78, 0.7],
		hood: [0.99, 0.7],
		nose: 0.55,
		round: 0.9,
		pillars: [0.48, 0.24]
	},
	'land-rover/range-rover-sport-phev': {
		base: 'suv',
		size: [4946, 1820, 2997],
		tail: [0.004, 0.82],
		roofRear: [0.07, 0.96],
		cowl: [0.77, 0.68],
		hood: [0.985, 0.66]
	},
	'land-rover/range-rover-velar-phev': {
		base: 'crossover',
		size: [4797, 1685, 2874],
		tail: [0.006, 0.76],
		roofRear: [0.08, 0.92],
		roofFront: [0.62, 1],
		cowl: [0.74, 0.65],
		hood: [0.98, 0.62],
		belt: 0.64
	},
	'lexus/ux-300e': {
		base: 'crossover',
		size: [4495, 1545, 2640],
		tail: [0.01, 0.72],
		roofRear: [0.12, 0.95]
	},
	// Lotus
	'lotus/eletre': {
		base: 'coupesuv',
		tail: [0.004, 0.72],
		deck: null,
		roofRear: [0.14, 0.95],
		wheel: 0.5
	},
	'lotus/emeya': {
		base: 'liftback',
		roofRear: [0.36, 0.95],
		cowl: [0.72, 0.6],
		hood: [0.97, 0.5],
		nose: 0.34,
		wheel: 0.52
	},
	'm-hero/917': {
		base: 'suv',
		tail: [0, 0.92],
		roofRear: [0.02, 1],
		roofFront: [0.68, 1],
		crown: 0,
		cowl: [0.74, 0.72],
		hood: [0.99, 0.68],
		nose: 0.56,
		sill: 0.18,
		round: 0.5,
		wheel: 0.48,
		spare: true
	},
	// Maserati
	'maserati/grancabrio-folgore': { base: 'roadster', roofRear: [0.36, 0.88], cowl: [0.6, 0.66] },
	'maserati/granturismo-folgore': { base: 'gt' },
	'maserati/grecale-folgore': {
		base: 'crossover',
		tail: [0.008, 0.72],
		roofRear: [0.1, 0.95],
		cowl: [0.74, 0.65],
		wheel: 0.5
	},
	'maserati/mc20-folgore': { base: 'mid', size: [4669, 1221, 2700], roofRear: [0.38, 0.99] },
	'mclaren/artura': {
		base: 'mid',
		size: [4539, 1193, 2640],
		roofRear: [0.4, 0.98],
		roofFront: [0.58, 1],
		cowl: [0.75, 0.56]
	},
	// Mercedes-Benz
	'mercedes-benz/cla-ev': {
		base: 'fastsedan',
		tail: [0.005, 0.6],
		deck: [0.08, 0.64],
		roofRear: [0.32, 0.95],
		crown: 0.06
	},
	'mercedes-benz/eqa': { base: 'crossover', tail: [0.008, 0.76], roofRear: [0.08, 0.96] },
	'mercedes-benz/eqb': {
		base: 'suv',
		tail: [0.003, 0.84],
		roofRear: [0.03, 0.99],
		pillars: [0.45, 0.2]
	},
	'mercedes-benz/eqe': {
		base: 'fastsedan',
		roofRear: [0.27, 0.93],
		roofFront: [0.62, 0.97],
		crown: 0.08,
		cowl: [0.77, 0.63],
		hood: [0.97, 0.56]
	},
	'mercedes-benz/eqe-suv': {
		base: 'crossover',
		tail: [0.004, 0.74],
		roofRear: [0.08, 0.95],
		crown: 0.04,
		cowl: [0.77, 0.66],
		round: 1.2
	},
	'mercedes-benz/eqs': {
		base: 'liftback',
		tail: [0, 0.6],
		deck: [0.05, 0.64],
		roofRear: [0.29, 0.94],
		roofFront: [0.64, 0.97],
		crown: 0.08,
		cowl: [0.79, 0.63],
		hood: [0.97, 0.56],
		pillars: [0.5, 0.33]
	},
	'mercedes-benz/eqs-suv': {
		base: 'suv',
		tail: [0.004, 0.8],
		roofRear: [0.05, 0.97],
		crown: 0.03,
		round: 1.2,
		pillars: [0.47, 0.25]
	},
	'mercedes-benz/eqv': {
		base: 'mpv',
		tail: [0, 0.94],
		roofRear: [0.015, 1],
		cowl: [0.86, 0.62],
		hood: [0.985, 0.54],
		round: 0.7,
		pillars: [0.55, 0.3]
	},
	'mercedes-benz/g-580-eq': {
		base: 'suv',
		tail: [0, 0.92],
		roofRear: [0.02, 1],
		roofFront: [0.68, 1],
		crown: 0,
		cowl: [0.72, 0.72],
		hood: [0.99, 0.7],
		nose: 0.58,
		sill: 0.17,
		belt: 0.64,
		round: 0.35,
		pillars: [0.46, 0.22],
		spare: true
	},
	// MG
	'mg-motor/cyberster': {
		base: 'roadster',
		size: [4535, 1329, 2690],
		deck: [0.22, 0.7],
		roofRear: [0.42, 0.9],
		cowl: [0.62, 0.66]
	},
	'mg-motor/mg4': {
		base: 'hatch',
		tail: [0.01, 0.7],
		roofRear: [0.14, 0.95],
		roofFront: [0.57, 0.98],
		sill: 0.11
	},
	'mg-motor/s5': { base: 'crossover', tail: [0.008, 0.74], roofRear: [0.1, 0.96] },
	// Mini
	'mini/cooper-se': {
		base: 'micro',
		tail: [0, 0.8],
		roofRear: [0.04, 1],
		roofFront: [0.62, 1],
		crown: 0,
		cowl: [0.76, 0.64],
		hood: [0.98, 0.6],
		nose: 0.48,
		wheel: 0.48,
		pillars: [0.42],
		round: 1.3
	},
	'mini/countryman': { base: 'suv', tail: [0.003, 0.82], round: 1.2 },
	'mitsubishi/eclipse-cross-ev': {
		base: 'coupesuv',
		deck: null,
		tail: [0.01, 0.72],
		roofRear: [0.16, 0.95]
	},
	// NIO
	'nio/ec6': { base: 'coupesuv', roofRear: [0.32, 0.96] },
	'nio/ec7': { base: 'coupesuv', roofRear: [0.36, 0.95], crown: 0.06, hood: [0.97, 0.56] },
	'nio/es6': { base: 'crossover', tail: [0.006, 0.76], roofRear: [0.08, 0.97] },
	'nio/es7': { base: 'suv', tail: [0.005, 0.8], roofRear: [0.06, 0.97] },
	'nio/es8': { base: 'suv', tail: [0.004, 0.82], pillars: [0.47, 0.25] },
	'nio/et5': { base: 'fastsedan', roofRear: [0.28, 0.93] },
	'nio/et7': { base: 'fastsedan', roofRear: [0.3, 0.94], pillars: [0.47] },
	'nio/et9': { base: 'sedan', roofRear: [0.3, 0.97], deck: [0.1, 0.68], pillars: [0.48] },
	'nio/firefly-ev': {
		base: 'micro',
		tail: [0, 0.76],
		roofRear: [0.07, 0.97],
		crown: 0.04,
		round: 1.4,
		wheel: 0.44
	},
	// Nissan
	'nissan/leaf': {
		base: 'hatch',
		tail: [0.01, 0.72],
		roofRear: [0.12, 0.96],
		roofFront: [0.57, 0.98],
		crown: 0.04
	},
	'nissan/micra-ev': {
		base: 'hatch',
		size: [3974, 1530, 2540],
		tail: [0.004, 0.76],
		roofRear: [0.08, 0.98],
		wheel: 0.48
	},
	// Peugeot
	'peugeot/e-2008': {
		base: 'crossover',
		tail: [0.008, 0.74],
		roofRear: [0.1, 0.96],
		hood: [0.975, 0.62]
	},
	'peugeot/e-208': { base: 'hatch', tail: [0.008, 0.74], roofRear: [0.1, 0.97] },
	'peugeot/e-3008': {
		base: 'coupesuv',
		size: [4542, 1641, 2739],
		roofRear: [0.3, 0.97],
		deck: [0.05, 0.72]
	},
	'peugeot/e-408': {
		base: 'liftback',
		size: [4690, 1480, 2787],
		roofRear: [0.36, 0.96],
		sill: 0.12,
		wheel: 0.5
	},
	'peugeot/e-5008': {
		base: 'suv',
		size: [4791, 1694, 2901],
		tail: [0.004, 0.8],
		pillars: [0.47, 0.24]
	},
	// Porsche
	'porsche/718-boxster': { base: 'mid', size: [4379, 1281, 2475], roofRear: [0.44, 0.92] },
	'porsche/718-cayman': { base: 'mid', size: [4379, 1295, 2475], roofRear: [0.36, 0.99] },
	'porsche/macan': {
		base: 'coupesuv',
		size: [4784, 1622, 2893],
		roofRear: [0.3, 0.96],
		deck: [0.05, 0.69],
		cowl: [0.74, 0.64],
		hood: [0.975, 0.56]
	},
	'porsche/taycan': {
		base: 'fastsedan',
		tail: [0, 0.58],
		deck: [0.07, 0.62],
		roofRear: [0.32, 0.94],
		roofFront: [0.58, 0.99],
		crown: 0.07,
		cowl: [0.72, 0.58],
		hood: [0.97, 0.46],
		nose: 0.34,
		wheel: 0.52
	},
	// Renault (the dataset's 1.9 m height for the Renault 4 is the roof-box figure)
	'renault/4-e-tech': {
		base: 'crossover',
		size: [4140, 1570, 2620],
		tail: [0, 0.8],
		roofRear: [0.05, 0.99],
		roofFront: [0.62, 1],
		crown: 0,
		cowl: [0.76, 0.66],
		round: 0.8
	},
	'renault/5-e-tech': {
		base: 'hatch',
		tail: [0, 0.76],
		roofRear: [0.08, 0.98],
		crown: 0.01,
		wheel: 0.5,
		round: 0.8
	},
	'renault/kangoo-e-tech': { base: 'mpv', cowl: [0.82, 0.64], hood: [0.98, 0.56] },
	'renault/megane-e-tech-electric': {
		base: 'hatch',
		tail: [0.01, 0.7],
		roofRear: [0.13, 0.96],
		sill: 0.12,
		wheel: 0.48
	},
	'renault/scenic-e-tech': { base: 'crossover', tail: [0.006, 0.76], roofRear: [0.08, 0.97] },
	'rimac/nevera': { base: 'mid', roofRear: [0.42, 0.99], cowl: [0.72, 0.56], wheel: 0.58 },
	'rolls-royce/spectre': {
		base: 'gt',
		tail: [0.004, 0.64],
		deck: [0.06, 0.68],
		roofRear: [0.3, 0.96],
		roofFront: [0.52, 1],
		cowl: [0.63, 0.7],
		hood: [0.985, 0.66],
		nose: 0.5,
		belt: 0.68,
		round: 0.9
	},
	// Škoda
	'skoda/elroq': {
		base: 'crossover',
		size: [4488, 1625, 2765],
		tail: [0.008, 0.76],
		roofRear: [0.09, 0.97]
	},
	'skoda/elroq-rs': {
		base: 'crossover',
		size: [4488, 1625, 2765],
		tail: [0.008, 0.76],
		roofRear: [0.09, 0.97]
	},
	'skoda/enyaq-coupe-iv': { base: 'coupesuv', roofRear: [0.32, 0.97], deck: [0.05, 0.71] },
	'skoda/enyaq-iv': { base: 'crossover', tail: [0.006, 0.77], roofRear: [0.07, 0.97] },
	// Smart
	'smart/1': {
		base: 'crossover',
		tail: [0.004, 0.76],
		roofRear: [0.08, 0.96],
		crown: 0.04,
		cowl: [0.78, 0.65],
		round: 1.4
	},
	'smart/3': { base: 'coupesuv', roofRear: [0.3, 0.95], crown: 0.06, round: 1.3 },
	// Tesla
	'tesla/model-3': {
		base: 'fastsedan',
		tail: [0, 0.58],
		deck: [0.07, 0.62],
		roofRear: [0.27, 0.93],
		roofFront: [0.6, 0.96],
		crown: 0.08,
		cowl: [0.75, 0.6],
		hood: [0.97, 0.51],
		nose: 0.37
	},
	'tesla/model-s': {
		base: 'liftback',
		tail: [0, 0.6],
		deck: [0.05, 0.63],
		roofRear: [0.32, 0.95],
		roofFront: [0.6, 0.98],
		crown: 0.05,
		cowl: [0.75, 0.6],
		hood: [0.97, 0.5],
		nose: 0.36
	},
	'tesla/model-x': {
		base: 'coupesuv',
		tail: [0, 0.7],
		deck: [0.04, 0.74],
		roofRear: [0.2, 0.94],
		roofFront: [0.64, 0.98],
		crown: 0.09,
		cowl: [0.79, 0.64],
		hood: [0.97, 0.57],
		nose: 0.44,
		pillars: [0.5]
	},
	'tesla/model-y': {
		base: 'coupesuv',
		tail: [0, 0.66],
		deck: [0.05, 0.7],
		roofRear: [0.24, 0.93],
		roofFront: [0.62, 0.97],
		crown: 0.08,
		cowl: [0.76, 0.63],
		hood: [0.97, 0.55],
		nose: 0.42
	},
	// Toyota
	'toyota/c-hr': {
		base: 'coupesuv',
		size: [4520, 1620, 2750],
		roofRear: [0.26, 0.96],
		wheel: 0.5
	},
	'toyota/urban-cruiser': {
		base: 'suv',
		size: [4285, 1640, 2700],
		tail: [0.004, 0.8],
		roofRear: [0.06, 0.98]
	},
	// Volkswagen
	'volkswagen/id-buzz': {
		base: 'mpv',
		tail: [0, 0.9],
		roofRear: [0.025, 1],
		roofFront: [0.76, 1],
		crown: 0.01,
		cowl: [0.9, 0.6],
		hood: [0.995, 0.5],
		nose: 0.34,
		belt: 0.55,
		pillars: [0.6, 0.32],
		wheel: 0.4,
		round: 1.6
	},
	'volkswagen/id-3': {
		base: 'hatch',
		tail: [0.01, 0.74],
		roofRear: [0.1, 0.96],
		roofFront: [0.6, 0.98],
		cowl: [0.76, 0.62],
		wheel: 0.46
	},
	'volkswagen/id-4': { base: 'crossover', tail: [0.008, 0.76], roofRear: [0.09, 0.97] },
	'volkswagen/id-5': { base: 'coupesuv', roofRear: [0.33, 0.97], deck: [0.05, 0.71] },
	'volkswagen/id-7': { base: 'liftback', roofRear: [0.34, 0.96], cowl: [0.75, 0.64] },
	// Volvo
	'volvo/ec40': { base: 'coupesuv', roofRear: [0.3, 0.96], deck: [0.05, 0.72] },
	'volvo/ex30': {
		base: 'crossover',
		tail: [0.004, 0.78],
		roofRear: [0.07, 0.98],
		wheel: 0.48,
		round: 0.9
	},
	'volvo/ex40': { base: 'suv', tail: [0.004, 0.8], roofRear: [0.06, 0.96], belt: 0.65 },
	'volvo/ex90': {
		base: 'suv',
		tail: [0.004, 0.8],
		roofRear: [0.05, 0.98],
		round: 1,
		pillars: [0.47, 0.24]
	},
	// Voyah
	'voyah/courage': { base: 'crossover', tail: [0.008, 0.74], roofRear: [0.1, 0.96] },
	'voyah/dream': {
		base: 'mpv',
		tail: [0, 0.9],
		roofRear: [0.02, 1],
		cowl: [0.84, 0.64],
		hood: [0.98, 0.58],
		pillars: [0.52, 0.28]
	},
	'voyah/free': { base: 'suv', tail: [0.005, 0.8], roofRear: [0.07, 0.97] },
	// Zeekr
	'zeekr/001': {
		base: 'wagon',
		tail: [0.006, 0.68],
		roofRear: [0.07, 0.92],
		roofFront: [0.57, 0.99],
		crown: 0.03,
		wheel: 0.5
	},
	'zeekr/007': { base: 'fastsedan', roofRear: [0.29, 0.93] },
	'zeekr/009': {
		base: 'mpv',
		tail: [0, 0.94],
		roofRear: [0.015, 1],
		cowl: [0.82, 0.66],
		hood: [0.98, 0.62],
		nose: 0.46,
		round: 0.6,
		pillars: [0.52, 0.28]
	},
	'zeekr/7x': { base: 'crossover', tail: [0.006, 0.76], roofRear: [0.08, 0.97], round: 1.1 },
	'zeekr/x': {
		base: 'crossover',
		tail: [0.01, 0.72],
		roofRear: [0.12, 0.95],
		crown: 0.04,
		round: 1.2
	}
};
