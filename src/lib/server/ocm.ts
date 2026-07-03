import type { ConnectorType } from '$lib/types';

// Open Charge Map connection-type ids → our connector types.
// 33 = CCS (Type 2 combo), 2 = CHAdeMO, 25 = Type 2 socket, 1036 = Type 2 tethered.
// Unknown ids are ignored (OCM has many exotic types irrelevant in Iceland).
const CONNECTION_TYPE_MAP: Record<number, ConnectorType> = {
	33: 'CCS2',
	2: 'CHAdeMO',
	25: 'Type2',
	1036: 'Type2'
};

export interface NetworkMatcher {
	slug: string;
	ocmOperatorIds: number[];
	ocmMatchers: string[];
}

export interface MatchedOperator {
	operator: string;
	operatorId: number | null;
	slug: string;
	via: 'id' | 'title';
}

export interface StationTitleMatch {
	station: string;
	ocmId: number;
	slug: string;
}

export interface DuplicateGroup {
	station: string;
	slug: string;
	keptOcmId: number;
	droppedOcmIds: number[];
}

// OCM catch-all operators that carry no network information:
// 1 = (Unknown Operator), 44 = (Private Residence/Individual), 45 = (Business Owner at Location).
const GENERIC_OPERATOR_IDS = new Set([1, 44, 45]);

export interface StationDraft {
	ocmId: number;
	networkSlug: string;
	name: string;
	address: string | null;
	lat: number;
	lng: number;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
}

interface OcmPoi {
	ID: number;
	OperatorInfo?: { ID?: number; Title?: string } | null;
	AddressInfo?: {
		Title?: string;
		AddressLine1?: string | null;
		Town?: string | null;
		Latitude?: number;
		Longitude?: number;
	} | null;
	Connections?:
		{ ConnectionTypeID?: number; PowerKW?: number | null; Quantity?: number | null }[] | null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word, case-insensitive title match. \b is ASCII-only, so use Unicode property classes.
const wordRegex = (m: string) =>
	new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(m)}(?![\\p{L}\\p{N}])`, 'iu');

export function parseOcm(
	pois: OcmPoi[],
	matchers: NetworkMatcher[]
): {
	drafts: StationDraft[];
	skipped: { operator: string; count: number }[];
	matched: MatchedOperator[];
	titleMatched: StationTitleMatch[];
	duplicates: DuplicateGroup[];
} {
	const compiled = matchers.map((m) => ({ ...m, regexes: m.ocmMatchers.map(wordRegex) }));
	const candidates: { draft: StationDraft; viaStationTitle: boolean }[] = [];
	const skippedCounts = new Map<string, number>();
	const matchedByKey = new Map<string, MatchedOperator>();

	for (const poi of pois) {
		const operator = poi.OperatorInfo?.Title ?? '(no operator)';
		const operatorId = poi.OperatorInfo?.ID ?? null;
		const a = poi.AddressInfo;
		const stationTitle = a?.Title;
		const byId =
			operatorId != null ? compiled.find((m) => m.ocmOperatorIds.includes(operatorId)) : undefined;
		let network = byId ?? compiled.find((m) => m.regexes.some((r) => r.test(operator)));
		let viaStationTitle = false;
		// Iceland's OCM data is mostly unattributed — of our networks only ON and Tesla
		// carry an operator. Branded station titles ("Ísorka - Olís X", "Staðarskáli (N1)")
		// are the only signal for the rest, so fall back to them, but never override a POI
		// attributed to a real third-party operator.
		if (!network && stationTitle && (operatorId == null || GENERIC_OPERATOR_IDS.has(operatorId))) {
			network = compiled.find((m) => m.regexes.some((r) => r.test(stationTitle)));
			viaStationTitle = network != null;
		}
		if (!network || !stationTitle || a?.Latitude == null || a?.Longitude == null) {
			skippedCounts.set(operator, (skippedCounts.get(operator) ?? 0) + 1);
			continue;
		}
		if (!viaStationTitle) {
			matchedByKey.set(`${operatorId}:${operator}`, {
				operator,
				operatorId,
				slug: network.slug,
				via: byId ? 'id' : 'title'
			});
		}

		const byKey = new Map<string, { type: ConnectorType; powerKw: number; count: number }>();
		for (const c of poi.Connections ?? []) {
			const type = c.ConnectionTypeID != null ? CONNECTION_TYPE_MAP[c.ConnectionTypeID] : undefined;
			if (!type || c.PowerKW == null) continue;
			const key = `${type}:${c.PowerKW}`;
			const entry = byKey.get(key) ?? { type, powerKw: c.PowerKW, count: 0 };
			entry.count += c.Quantity ?? 1;
			byKey.set(key, entry);
		}

		candidates.push({
			draft: {
				ocmId: poi.ID,
				networkSlug: network.slug,
				name: stationTitle,
				address: [a.AddressLine1, a.Town].filter(Boolean).join(', ') || null,
				lat: a.Latitude,
				lng: a.Longitude,
				connectors: [...byKey.values()]
			},
			viaStationTitle
		});
	}

	// OCM Iceland was bulk-imported several times, so the same station appears under
	// multiple POI ids with identical name and coordinates. Keep the newest copy.
	const byStation = new Map<string, { draft: StationDraft; viaStationTitle: boolean }[]>();
	for (const c of candidates) {
		const key = `${c.draft.networkSlug}|${c.draft.name}|${c.draft.lat}|${c.draft.lng}`;
		byStation.set(key, [...(byStation.get(key) ?? []), c]);
	}

	const drafts: StationDraft[] = [];
	const titleMatched: StationTitleMatch[] = [];
	const duplicates: DuplicateGroup[] = [];
	for (const group of byStation.values()) {
		const kept = group.reduce((a, b) => (b.draft.ocmId > a.draft.ocmId ? b : a));
		if (group.length > 1) {
			duplicates.push({
				station: kept.draft.name,
				slug: kept.draft.networkSlug,
				keptOcmId: kept.draft.ocmId,
				droppedOcmIds: group
					.filter((g) => g !== kept)
					.map((g) => g.draft.ocmId)
					.sort((x, y) => x - y)
			});
		}
		drafts.push(kept.draft);
		if (kept.viaStationTitle) {
			titleMatched.push({
				station: kept.draft.name,
				ocmId: kept.draft.ocmId,
				slug: kept.draft.networkSlug
			});
		}
	}

	return {
		drafts,
		skipped: [...skippedCounts.entries()].map(([operator, count]) => ({ operator, count })),
		matched: [...matchedByKey.values()],
		titleMatched,
		duplicates
	};
}
