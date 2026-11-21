import { describe, expect, it } from 'vitest';
import { planSiteSync } from './site-sync';

type Site = { id: number; name: string; lat: number; lng: number };
type Ours = Site & { stamp?: number };

const named = {
	maxM: 400,
	siteName: (s: Site) => s.name,
	stationName: (s: Ours) => s.name
};

// Real rows (2026-11): Virta site 181839 and our OCM station 37, 226 m apart.
const klausturSite: Site = {
	id: 181839,
	name: 'Ísorka - Olís Kirkjubæjarklaustur',
	lat: 63.79465,
	lng: -18.03846
};
const klausturOcm: Ours = {
	id: 37,
	name: 'Ísorka - Olís Kirkjubæjarklaustur',
	lat: 63.79373,
	lng: -18.04256
};

describe('planSiteSync', () => {
	it('pairs by distance only within maxM', () => {
		const plan = planSiteSync([klausturSite], [klausturOcm], (s) => s.stamp, 30);
		expect(plan.matched).toEqual([]);
		expect(plan.toInsert.map((s) => s.id)).toEqual([181839]);
	});

	it('with a same-name pass, pairs a far-off OCM pin of the same site instead of adding it again', () => {
		const plan = planSiteSync([klausturSite], [klausturOcm], (s) => s.stamp, 30, named);
		expect(plan.matched.map((m) => [m.site.id, m.station.id])).toEqual([[181839, 37]]);
		expect(plan.toInsert).toEqual([]);
	});

	it('the name pass needs the same name, an unstamped station, and the wider radius', () => {
		const other = { ...klausturOcm, name: 'Kjarval Kirkjubæjarklaustri' };
		expect(planSiteSync([klausturSite], [other], (s) => s.stamp, 30, named).matched).toEqual([]);
		const stamped = { ...klausturOcm, stamp: 999 };
		expect(planSiteSync([klausturSite], [stamped], (s) => s.stamp, 30, named).matched).toEqual([]);
		const far = { ...klausturOcm, lat: klausturOcm.lat + 0.01 }; // ~1.1 km
		expect(planSiteSync([klausturSite], [far], (s) => s.stamp, 30, named).matched).toEqual([]);
	});

	it('distance pairs win over name pairs', () => {
		const near: Ours = { id: 5, name: 'Olís', lat: klausturSite.lat, lng: klausturSite.lng };
		const plan = planSiteSync([klausturSite], [klausturOcm, near], (s) => s.stamp, 30, named);
		expect(plan.matched.map((m) => m.station.id)).toEqual([5]);
		expect(plan.unclaimed.map((s) => s.id)).toEqual([37]);
	});
});
