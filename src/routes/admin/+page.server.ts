// NO AUTH IN APP CODE by design: production MUST front /admin with Caddy
// basic-auth (Phase 4 checklist). Until then this page exists only on dev machines.
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	bumpVerified,
	scraperHealth,
	setStationActive,
	submitManualPrice
} from '$lib/server/admin';
import { currentPrices } from '$lib/server/db/queries';
import { openReports, resolveReport } from '$lib/server/reports';
import { connectors, networks, stations } from '$lib/server/db/schema';
import {
	ambiguousTomtomIds,
	isUnderConstruction,
	isUnderConstructionName,
	networkConflicts
} from '$lib/server/station-audit';
import {
	dismissDuplicate,
	duplicateCandidates,
	formatConnectorSpec,
	mergeStations,
	overridesByStation,
	parseOverrideForm,
	saveStationOverride
} from '$lib/server/stations-admin';
import * as m from '$lib/paraglide/messages';
import type { SeoMeta } from '$lib/seo';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const [nets, sts, cp, health, reports, dupes, overrides] = await Promise.all([
		db.select().from(networks),
		db.select().from(stations),
		currentPrices(db),
		scraperHealth(db),
		openReports(db),
		duplicateCandidates(db),
		overridesByStation(db)
	]);
	const netName = new Map(nets.map((n) => [n.id, n.name]));
	const netSlug = new Map(nets.map((n) => [n.id, n.slug]));
	const byId = new Map(sts.map((s) => [s.id, s]));
	const stName = new Map(sts.map((s) => [s.id, s.name]));
	// "Skrá verð" on a report links here with ?stod=<id>: preselect that station's form
	const preStation = sts.find((s) => s.id === Number(url.searchParams.get('stod')));
	const brief = (s: { id: number; name: string; slug: string; networkId: number }) => ({
		id: s.id,
		name: s.name,
		slug: s.slug,
		networkName: netName.get(s.networkId) ?? ''
	});
	const active = sts.filter((s) => s.isActive);

	const conflicts = networkConflicts(
		active.map((s) => ({
			...s,
			networkSlug: netSlug.get(s.networkId) ?? '',
			lat: s.location.y,
			lng: s.location.x
		}))
	).map((c) =>
		c.kind === 'name'
			? { kind: c.kind, station: brief(c.station), brands: c.brands }
			: {
					kind: c.kind,
					station: brief(c.station),
					other: brief(c.other),
					distanceM: Math.round(c.distanceM)
				}
	);

	const ambiguous = ambiguousTomtomIds(sts);
	const sharedTomtom = [...ambiguous].map((tomtomId) => ({
		tomtomId,
		stations: active.filter((s) => s.externalIds.tomtom === tomtomId).map(brief)
	}));

	const editId = Number(url.searchParams.get('leidretta'));
	const editing = Number.isInteger(editId) ? byId.get(editId) : undefined;
	let edit = null;
	if (editing) {
		const ov = overrides.get(editing.id);
		const cs = await db.select().from(connectors).where(eq(connectors.stationId, editing.id));
		edit = {
			...brief(editing),
			networkId: editing.networkId,
			underConstruction: editing.underConstruction,
			connectors: formatConnectorSpec(cs),
			override: ov
				? {
						name: ov.name,
						networkId: ov.networkId,
						connectors: ov.connectors ? formatConnectorSpec(ov.connectors) : null,
						note: ov.note
					}
				: null
		};
	}

	return {
		health,
		reports,
		preselect: preStation ? { stationId: preStation.id, networkId: preStation.networkId } : null,
		networks: nets
			.map((n) => ({ id: n.id, name: n.name }))
			.sort((a, b) => a.name.localeCompare(b.name, 'is')),
		stations: sts
			.map((s) => ({
				id: s.id,
				name: s.name,
				networkName: netName.get(s.networkId) ?? '',
				isActive: s.isActive,
				mergedInto: s.mergedIntoId === null ? null : (stName.get(s.mergedIntoId) ?? null),
				overridden: overrides.has(s.id)
			}))
			.sort(
				(a, b) =>
					a.networkName.localeCompare(b.networkName, 'is') || a.name.localeCompare(b.name, 'is')
			),
		prices: cp
			.map((p) => ({
				id: p.id,
				networkName: netName.get(p.networkId) ?? '',
				stationName: p.stationId === null ? null : (stName.get(p.stationId) ?? `#${p.stationId}`),
				tariffKey: p.tariffKey,
				priceIskPerKwh: p.priceIskPerKwh,
				minuteFeeIsk: p.minuteFeeIsk,
				minuteFeeAfterMin: p.minuteFeeAfterMin,
				verifiedAt: p.verifiedAt
			}))
			.sort(
				(a, b) =>
					a.networkName.localeCompare(b.networkName, 'is') ||
					(a.stationName ?? '').localeCompare(b.stationName ?? '', 'is') ||
					a.tariffKey.localeCompare(b.tariffKey)
			),
		seo: { title: `${m.admin_title()} — ${m.site_title()}`, noindex: true } satisfies SeoMeta,
		duplicates: dupes.map((d) => ({
			a: brief(d.a),
			b: brief(d.b),
			distanceM: Math.round(d.distanceM),
			reasons: d.reasons
		})),
		conflicts,
		sharedTomtom,
		underConstruction: active
			.filter((s) => isUnderConstruction(s))
			.map((s) => ({ ...brief(s), byHand: s.underConstruction !== null }))
			.concat(
				// flagged open by hand although the name says otherwise: worth seeing too
				active
					.filter((s) => s.underConstruction === false && isUnderConstructionName(s.name))
					.map((s) => ({ ...brief(s), byHand: true }))
			),
		overrides: [...overrides.values()]
			.map((o) => ({
				station: byId.has(o.stationId) ? brief(byId.get(o.stationId)!) : null,
				name: o.name,
				networkName: o.networkId === null ? null : (netName.get(o.networkId) ?? null),
				connectors: o.connectors ? formatConnectorSpec(o.connectors) : null,
				note: o.note,
				updatedAt: o.updatedAt
			}))
			.filter((o) => o.station !== null),
		edit
	};
};

const ids = (form: FormData, ...keys: string[]) => keys.map((k) => Number(form.get(k)));

export const actions: Actions = {
	price: async ({ request }) => {
		const res = await submitManualPrice(db, await request.formData());
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	},
	verify: async ({ request }) => {
		const form = await request.formData();
		const res = await bumpVerified(db, Number(form.get('priceId')));
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	},
	resolveReport: async ({ request }) => {
		const form = await request.formData();
		const ok = await resolveReport(db, Number(form.get('reportId')));
		return ok ? { saved: true } : fail(400, { error: 'tilkynning fannst ekki eða er þegar leyst' });
	},
	stationActive: async ({ request }) => {
		const form = await request.formData();
		const res = await setStationActive(
			db,
			Number(form.get('stationId')),
			form.get('isActive') === 'true'
		);
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	},
	merge: async ({ request }) => {
		const [survivorId, mergedId] = ids(await request.formData(), 'survivorId', 'mergedId');
		const res = await mergeStations(db, survivorId, mergedId);
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	},
	dismiss: async ({ request }) => {
		const [a, b] = ids(await request.formData(), 'a', 'b');
		const res = await dismissDuplicate(db, a, b);
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	},
	override: async ({ request }) => {
		const input = parseOverrideForm(await request.formData());
		if ('error' in input) return fail(400, { error: input.error });
		const res = await saveStationOverride(db, input);
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	}
};
