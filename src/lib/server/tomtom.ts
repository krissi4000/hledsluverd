import type { ConnectorType } from '$lib/types';

const BASE = 'https://api.tomtom.com/search/2';

/** TomTom connector type → our enum; unmapped types still count into the totals. */
const CONNECTOR_MAP: Record<string, ConnectorType> = {
	IEC62196Type2CCS: 'CCS2',
	Chademo: 'CHAdeMO',
	IEC62196Type2Outlet: 'Type2',
	IEC62196Type2CableAttached: 'Type2'
};

interface TomTomCurrent {
	available: number;
	occupied: number;
	reserved: number;
	unknown: number;
	outOfService: number;
}

export interface TomTomAvailabilityResponse {
	connectors: {
		type: string;
		total: number;
		availability: { current: TomTomCurrent };
	}[];
	chargingAvailability: string;
}

export interface ParsedAvailability {
	freeCount: number;
	totalCount: number;
	perType: Partial<Record<ConnectorType, { free: number; total: number }>>;
}

/** An empty connectors array means TomTom does not know the id — we know nothing, store nothing. */
export function parseChargingAvailability(
	body: TomTomAvailabilityResponse
): ParsedAvailability | null {
	if (!Array.isArray(body.connectors)) throw new Error('TomTom availability: unexpected shape');
	if (body.connectors.length === 0) return null;
	const parsed: ParsedAvailability = { freeCount: 0, totalCount: 0, perType: {} };
	for (const c of body.connectors) {
		const cur = c.availability?.current;
		if (!cur || typeof c.total !== 'number' || typeof cur.available !== 'number') {
			throw new Error('TomTom availability: unexpected shape');
		}
		parsed.freeCount += cur.available;
		parsed.totalCount += c.total;
		const mapped = CONNECTOR_MAP[c.type];
		if (mapped) {
			const t = (parsed.perType[mapped] ??= { free: 0, total: 0 });
			t.free += cur.available;
			t.total += c.total;
		}
	}
	return parsed;
}

export async function fetchChargingAvailability(
	key: string,
	chargingAvailabilityId: string,
	fetchFn: typeof fetch = fetch
): Promise<ParsedAvailability | null> {
	const url =
		`${BASE}/chargingAvailability.json?key=${encodeURIComponent(key)}` +
		`&chargingAvailability=${encodeURIComponent(chargingAvailabilityId)}`;
	const res = await fetchFn(url, { signal: AbortSignal.timeout(3000) });
	if (!res.ok) throw new Error(`TomTom availability HTTP ${res.status}`);
	return parseChargingAvailability((await res.json()) as TomTomAvailabilityResponse);
}
