import { and, eq, isNull, ne } from 'drizzle-orm';
import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';
import type { Db } from './db/client';
import {
	connectors,
	networks,
	stationDuplicateReviews,
	stationOverrides,
	stationSlugRedirects,
	stations
} from './db/schema';
import { findDuplicateCandidates, mergeExternalIds, pairKey } from './duplicates';
import { slugify } from './slug';

export interface AdminResult {
	ok: boolean;
	error?: string;
}

type Connector = { type: ConnectorType; powerKw: number; count: number };
type Station = typeof stations.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Duplicates

/** Active stations shaped for duplicate detection. */
async function activeStations(db: Db) {
	const rows = await db
		.select()
		.from(stations)
		.where(and(eq(stations.isActive, true), isNull(stations.mergedIntoId)));
	return rows.map((s) => ({ ...s, lat: s.location.y, lng: s.location.x }));
}

/**
 * Current duplicate candidates among active stations, minus pairs a human dismissed.
 * `notified`: the daily note already reported the pair.
 */
export async function duplicateCandidates(db: Db) {
	const [sts, reviews] = await Promise.all([
		activeStations(db),
		db.select().from(stationDuplicateReviews)
	]);
	const dismissed = new Set(
		reviews.filter((r) => r.dismissedAt).map((r) => pairKey(r.stationAId, r.stationBId))
	);
	const notified = new Set(
		reviews.filter((r) => r.notifiedAt).map((r) => pairKey(r.stationAId, r.stationBId))
	);
	return findDuplicateCandidates(sts, dismissed).map((c) => ({
		...c,
		notified: notified.has(pairKey(c.a.id, c.b.id))
	}));
}

/** "Not a duplicate": hides the pair from /admin and the daily note for good. */
export async function dismissDuplicate(db: Db, x: number, y: number): Promise<AdminResult> {
	if (!Number.isInteger(x) || !Number.isInteger(y) || x === y) {
		return { ok: false, error: 'ógilt par' };
	}
	const [a, b] = x < y ? [x, y] : [y, x];
	await db
		.insert(stationDuplicateReviews)
		.values({ stationAId: a, stationBId: b, dismissedAt: new Date() })
		.onConflictDoUpdate({
			target: [stationDuplicateReviews.stationAId, stationDuplicateReviews.stationBId],
			set: { dismissedAt: new Date() }
		});
	return { ok: true };
}

/** Records that the daily ntfy note has told a human about these pairs. */
export async function markNotified(db: Db, pairs: [number, number][]): Promise<void> {
	for (const [x, y] of pairs) {
		const [a, b] = x < y ? [x, y] : [y, x];
		await db
			.insert(stationDuplicateReviews)
			.values({ stationAId: a, stationBId: b, notifiedAt: new Date() })
			.onConflictDoUpdate({
				target: [stationDuplicateReviews.stationAId, stationDuplicateReviews.stationBId],
				set: { notifiedAt: new Date() }
			});
	}
}

/**
 * Merge a duplicate into the station that stays. The survivor keeps its own name, slug,
 * connectors and price history and gains the merged one's site ids it lacks (see
 * mergeExternalIds). The merged station is deactivated, not deleted: its price history
 * stays with it, its /stod/ slug redirects to the survivor, and its OCM id stops seed:ocm
 * from adding it again.
 */
export async function mergeStations(
	db: Db,
	survivorId: number,
	mergedId: number
): Promise<AdminResult> {
	if (!Number.isInteger(survivorId) || !Number.isInteger(mergedId) || survivorId === mergedId) {
		return { ok: false, error: 'ógild sameining' };
	}
	return db.transaction(async (tx) => {
		const [survivor] = await tx.select().from(stations).where(eq(stations.id, survivorId));
		const [merged] = await tx.select().from(stations).where(eq(stations.id, mergedId));
		if (!survivor || !merged) return { ok: false, error: 'stöð fannst ekki' };
		if (!survivor.isActive || survivor.mergedIntoId !== null) {
			return { ok: false, error: `${survivor.name} er óvirk eða þegar sameinuð` };
		}
		if (merged.mergedIntoId !== null) {
			return { ok: false, error: `${merged.name} er þegar sameinuð annarri stöð` };
		}
		if (survivor.networkId !== merged.networkId) {
			return {
				ok: false,
				error: 'stöðvarnar tilheyra ekki sama fyrirtæki — leiðréttu fyrirtækið fyrst'
			};
		}
		const ids = mergeExternalIds(survivor.externalIds, merged.externalIds);
		await tx
			.update(stations)
			.set({ externalIds: ids.survivor })
			.where(eq(stations.id, survivor.id));
		await tx
			.update(stations)
			.set({ externalIds: ids.merged, isActive: false, mergedIntoId: survivor.id })
			.where(eq(stations.id, merged.id));
		// anything merged into the merged station now points at the survivor
		await tx
			.update(stations)
			.set({ mergedIntoId: survivor.id })
			.where(eq(stations.mergedIntoId, merged.id));
		const own = await tx.select().from(connectors).where(eq(connectors.stationId, survivor.id));
		if (own.length === 0) {
			const theirs = await tx.select().from(connectors).where(eq(connectors.stationId, merged.id));
			if (theirs.length > 0) {
				await tx.insert(connectors).values(
					theirs.map((c) => ({
						stationId: survivor.id,
						type: c.type,
						powerKw: c.powerKw,
						count: c.count
					}))
				);
			}
		}
		return { ok: true };
	});
}

// ---------------------------------------------------------------------------
// Slugs

/**
 * Where an unknown /stod/ slug should go: the station a merged duplicate went into, or a
 * renamed station's current slug. Null = 404 (unknown, or deactivated without a merge).
 */
export async function resolveStationSlug(db: Db, slug: string): Promise<string | null> {
	const byId = async (id: number) =>
		(await db.select().from(stations).where(eq(stations.id, id)))[0];
	let [cur]: (Station | undefined)[] = await db
		.select()
		.from(stations)
		.where(eq(stations.slug, slug));
	if (!cur) {
		const [r] = await db
			.select()
			.from(stationSlugRedirects)
			.where(eq(stationSlugRedirects.oldSlug, slug));
		if (!r) return null;
		cur = await byId(r.stationId);
	}
	for (let hop = 0; cur && hop < 10; hop++) {
		if (cur.isActive) return cur.slug === slug ? null : cur.slug;
		if (cur.mergedIntoId === null) return null;
		cur = await byId(cur.mergedIntoId);
	}
	return null;
}

/** slugify(`${name}-${network}`) like seed:ocm, suffixed with the id when taken. */
async function freeSlug(db: Db | Tx, stationId: number, name: string, networkSlug: string) {
	const base = slugify(`${name}-${networkSlug}`);
	const [taken] = await db
		.select({ id: stations.id })
		.from(stations)
		.where(and(eq(stations.slug, base), ne(stations.id, stationId)));
	return taken ? `${base}-${stationId}` : base;
}

// ---------------------------------------------------------------------------
// Overrides

/** "2×CCS2 150; 1×CHAdeMO 62,5" ↔ connectors. Count defaults to 1, "kW" optional. */
export function parseConnectorSpec(text: string): Connector[] | { error: string } {
	const parts = text
		.split(/\s*(?:[;\n]|,\s+)\s*/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return { error: 'engin tengi' };
	const out: Connector[] = [];
	for (const p of parts) {
		const m = p.match(/^(?:(\d+)\s*[x×*]\s*)?([a-z0-9]+)\s+(\d+(?:[.,]\d+)?)\s*(?:kw)?$/i);
		const type = m && CONNECTOR_TYPES.find((t) => t.toLowerCase() === m[2].toLowerCase());
		if (!m || !type) return { error: `skil ekki „${p}“ — dæmi: 2×CCS2 150` };
		const count = m[1] ? Number(m[1]) : 1;
		const powerKw = Number(m[3].replace(',', '.'));
		if (count < 1 || count > 100 || !(powerKw > 0 && powerKw <= 1000)) {
			return { error: `ótrúverðugt: „${p}“` };
		}
		out.push({ type, powerKw, count });
	}
	return out;
}

export function formatConnectorSpec(cs: Connector[]): string {
	return cs.map((c) => `${c.count}×${c.type} ${c.powerKw}`).join('; ');
}

export interface OverrideInput {
	stationId: number;
	/** null = no name override */
	name: string | null;
	/** null = no network override */
	networkId: number | null;
	/** null = no connector override */
	connectors: Connector[] | null;
	/** stations.under_construction: null = detect from the name */
	underConstruction: boolean | null;
	note: string | null;
}

/** Form → OverrideInput, or an error message. */
export function parseOverrideForm(form: FormData): OverrideInput | { error: string } {
	const str = (k: string) => {
		const v = form.get(k);
		return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
	};
	const stationId = Number(str('stationId'));
	if (!Number.isInteger(stationId) || stationId <= 0) return { error: 'ógild stöð' };
	const net = str('networkId');
	const networkId = net === null ? null : Number(net);
	if (networkId !== null && !Number.isInteger(networkId)) return { error: 'ógilt fyrirtæki' };
	const spec = str('connectors');
	const parsed = spec === null ? null : parseConnectorSpec(spec);
	if (parsed && 'error' in parsed) return { error: parsed.error };
	const uc = str('underConstruction');
	return {
		stationId,
		name: str('name'),
		networkId,
		connectors: parsed,
		underConstruction: uc === 'yes' ? true : uc === 'no' ? false : null,
		note: str('note')
	};
}

/**
 * Save an admin's correction and apply it to the station now. A changed name or network
 * also changes the slug (the old one redirects). seed:ocm and the syncs read the override
 * table and leave overridden fields alone. Clearing a field stops overriding it; the
 * upstream value returns with the next seed/sync.
 */
export async function saveStationOverride(db: Db, input: OverrideInput): Promise<AdminResult> {
	return db.transaction(async (tx) => {
		const [st] = await tx.select().from(stations).where(eq(stations.id, input.stationId));
		if (!st) return { ok: false, error: 'stöð fannst ekki' };
		const networkId = input.networkId ?? st.networkId;
		const [net] = await tx.select().from(networks).where(eq(networks.id, networkId));
		if (!net) return { ok: false, error: 'fyrirtæki fannst ekki' };

		const empty =
			input.name === null &&
			input.networkId === null &&
			input.connectors === null &&
			input.note === null;
		if (empty) {
			await tx.delete(stationOverrides).where(eq(stationOverrides.stationId, st.id));
		} else {
			const row = {
				name: input.name,
				networkId: input.networkId,
				connectors: input.connectors,
				note: input.note
			};
			await tx
				.insert(stationOverrides)
				.values({ stationId: st.id, ...row })
				.onConflictDoUpdate({ target: stationOverrides.stationId, set: row });
		}

		const name = input.name ?? st.name;
		let slug = st.slug;
		if (name !== st.name || networkId !== st.networkId) {
			slug = await freeSlug(tx, st.id, name, net.slug);
		}
		if (slug !== st.slug) {
			await tx
				.insert(stationSlugRedirects)
				.values({ oldSlug: st.slug, stationId: st.id })
				.onConflictDoUpdate({ target: stationSlugRedirects.oldSlug, set: { stationId: st.id } });
			await tx.delete(stationSlugRedirects).where(eq(stationSlugRedirects.oldSlug, slug));
		}
		await tx
			.update(stations)
			.set({ name, networkId, slug, underConstruction: input.underConstruction })
			.where(eq(stations.id, st.id));
		if (input.connectors) {
			await tx.delete(connectors).where(eq(connectors.stationId, st.id));
			await tx.insert(connectors).values(input.connectors.map((c) => ({ stationId: st.id, ...c })));
		}
		return { ok: true };
	});
}

export type StationOverride = typeof stationOverrides.$inferSelect;

/**
 * What an upstream writer (seed:ocm, the syncs) writes to a station an admin corrected:
 * the override's fields win, the rest is upstream's. `kept` names the fields it held back.
 */
export function applyOverride(
	upstream: { name: string; connectors: Connector[] },
	ov: Pick<StationOverride, 'name' | 'connectors'> | undefined
): { name: string; connectors: Connector[]; kept: ('name' | 'connectors')[] } {
	const kept: ('name' | 'connectors')[] = [];
	if (ov?.name) kept.push('name');
	if (ov?.connectors) kept.push('connectors');
	return {
		name: ov?.name ?? upstream.name,
		connectors: ov?.connectors ?? upstream.connectors,
		kept
	};
}

/** stationId → override, for the writers that must respect it (seed:ocm, the syncs). */
export async function overridesByStation(db: Db) {
	const rows = await db.select().from(stationOverrides);
	return new Map(rows.map((r) => [r.stationId, r]));
}
