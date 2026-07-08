import type { ConnectorType } from '$lib/types';

/** The subset of an OpenEV Data vehicle record that the import reads. */
export interface OpenEvVehicle {
	make: { slug: string; name: string };
	model: { slug: string; name: string };
	year: number;
	trim?: { slug: string; name: string } | null;
	variant?: { slug: string; name: string; kind?: string } | null;
	vehicle_type?: string;
	charge_ports?: { kind: string; connector: string }[];
	charging?: {
		ac?: { max_power_kw?: number } | null;
		dc?: { max_power_kw?: number } | null;
	} | null;
	markets?: string[];
	unique_code: string;
}

export interface CarSeed {
	make: string;
	model: string;
	variant: string;
	slug: string;
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

export interface CarsImportResult {
	cars: CarSeed[];
	skippedNonEuropean: number;
	skippedNoMappedPorts: number;
	warnings: string[];
}

/** Markets whose cars ship with European (IEC 62196) charge ports. */
const EUROPEAN_MARKETS = new Set([
	'IS',
	'DE',
	'GB',
	'FR',
	'IT',
	'ES',
	'PT',
	'NL',
	'BE',
	'LU',
	'AT',
	'CH',
	'IE',
	'DK',
	'SE',
	'NO',
	'FI',
	'PL',
	'CZ',
	'SK',
	'HU',
	'SI',
	'HR',
	'RO',
	'BG',
	'GR',
	'EE',
	'LV',
	'LT'
]);

// The dataset models the US/global build (Tesla → nacs, Leaf AC → type1). European
// builds of the same cars ship CCS2/Type2 inlets, so European-market records are
// normalized: nacs → CCS2, type1 → Type2. Chinese GB/T and US CCS1 ports have no
// European equivalent on the record itself — those ports are skipped with a warning.
const DC_MAP: Record<string, ConnectorType> = { ccs2: 'CCS2', nacs: 'CCS2', chademo: 'CHAdeMO' };
const AC_MAP: Record<string, ConnectorType> = { type2: 'Type2', type1: 'Type2' };

export function parseOpenEvData(data: { vehicles: OpenEvVehicle[] }): CarsImportResult {
	const out: CarsImportResult = {
		cars: [],
		skippedNonEuropean: 0,
		skippedNoMappedPorts: 0,
		warnings: []
	};
	for (const v of data.vehicles) {
		if (!(v.markets ?? []).some((mkt) => EUROPEAN_MARKETS.has(mkt))) {
			out.skippedNonEuropean++;
			continue;
		}
		let dcConnector: ConnectorType | null = null;
		let acConnector: ConnectorType | null = null;
		for (const p of v.charge_ports ?? []) {
			const dc = DC_MAP[p.connector];
			const ac = AC_MAP[p.connector];
			if ((p.kind === 'combo' || p.kind === 'dc_only') && dc) {
				// CCS2 beats CHAdeMO if a record somehow lists both DC ports
				if (dcConnector === null || dc === 'CCS2') dcConnector = dc;
			}
			// a CCS2 combo inlet accepts a plain Type2 AC plug
			if (p.kind === 'combo' && dc === 'CCS2') acConnector = 'Type2';
			if ((p.kind === 'ac_only' || p.kind === 'combo') && ac) acConnector = ac;
			if (!dc && !ac) out.warnings.push(`${v.unique_code}: unmapped port ${p.kind}:${p.connector}`);
		}
		if (!dcConnector && !acConnector) {
			out.skippedNoMappedPorts++;
			continue;
		}
		const variantParts = [
			v.trim?.name,
			v.variant?.name !== v.trim?.name ? v.variant?.name : null,
			String(v.year)
		];
		out.cars.push({
			make: v.make.name,
			model: v.model.name,
			variant: variantParts.filter(Boolean).join(' '),
			slug: v.unique_code.replace(/[:_]+/g, '-'),
			acConnector,
			maxAcKw: acConnector ? (v.charging?.ac?.max_power_kw ?? null) : null,
			dcConnector,
			maxDcKw: dcConnector ? (v.charging?.dc?.max_power_kw ?? null) : null
		});
	}
	return out;
}
