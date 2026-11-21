// NO AUTH IN APP CODE by design: production MUST front /admin with Caddy
// basic-auth (Phase 4 checklist). Until then this page exists only on dev machines.
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
	bumpVerified,
	scraperHealth,
	setStationActive,
	submitManualPrice
} from '$lib/server/admin';
import { currentPrices } from '$lib/server/db/queries';
import { openReports, resolveReport } from '$lib/server/reports';
import { networks, stations } from '$lib/server/db/schema';
import * as m from '$lib/paraglide/messages';
import type { SeoMeta } from '$lib/seo';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const [nets, sts, cp, health, reports] = await Promise.all([
		db.select().from(networks),
		db.select().from(stations),
		currentPrices(db),
		scraperHealth(db),
		openReports(db)
	]);
	const netName = new Map(nets.map((n) => [n.id, n.name]));
	const stName = new Map(sts.map((s) => [s.id, s.name]));
	// "Skrá verð" on a report links here with ?stod=<id>: preselect that station's form
	const preStation = sts.find((s) => s.id === Number(url.searchParams.get('stod')));
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
				isActive: s.isActive
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
		seo: { title: `${m.admin_title()} — ${m.site_title()}`, noindex: true } satisfies SeoMeta
	};
};

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
	}
};
