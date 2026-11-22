import { haversineKm, type LatLng } from '$lib/geo';
import { compareSiteNames } from './matching';

export interface SitePlan<S, T> {
	matched: { site: S; station: T; distanceM: number }[];
	/** sites no station claimed — new stations to add */
	toInsert: S[];
	/** our stations no site claimed — closed, moved, or not covered by this source */
	unclaimed: T[];
}

/**
 * A wider second pass by name: an OCM pin can sit hundreds of metres off the real post
 * (Ísorka - Olís Kirkjubæjarklaustur: 226 m), and a distance-only match then adds the site
 * a second time. Only a 'same' name counts at this range (see compareSiteNames).
 */
export interface SameNamePass<S, T> {
	maxM: number;
	siteName: (site: S) => string;
	stationName: (station: T) => string;
}

/**
 * Pair an external source's sites with our stations. A station already stamped with a
 * site's id keeps it; the rest pair by distance within maxM, closest pair first, so two
 * nearby sites (an old and a new one) can't both grab the same station. With sameName,
 * sites still unpaired then pair with an unstamped station of the same name within its
 * wider radius, again closest first.
 */
export function planSiteSync<S extends LatLng & { id: number }, T extends LatLng & { id: number }>(
	sites: S[],
	existing: T[],
	externalIdOf: (station: T) => number | undefined,
	maxM: number,
	sameName?: SameNamePass<S, T>
): SitePlan<S, T> {
	const matched: SitePlan<S, T>['matched'] = [];
	const claimedStations = new Set<number>();
	const claimedSites = new Set<number>();

	for (const site of sites) {
		const st = existing.find((e) => externalIdOf(e) === site.id);
		if (!st) continue;
		matched.push({ site, station: st, distanceM: haversineKm(site, st) * 1000 });
		claimedStations.add(st.id);
		claimedSites.add(site.id);
	}

	const pairUp = (radiusM: number, accept: (site: S, st: T) => boolean) => {
		const pairs: SitePlan<S, T>['matched'] = [];
		for (const site of sites) {
			if (claimedSites.has(site.id)) continue;
			for (const st of existing) {
				if (claimedStations.has(st.id) || externalIdOf(st) != null) continue;
				const distanceM = haversineKm(site, st) * 1000;
				if (distanceM <= radiusM && accept(site, st)) pairs.push({ site, station: st, distanceM });
			}
		}
		pairs.sort((a, b) => a.distanceM - b.distanceM);
		for (const p of pairs) {
			if (claimedSites.has(p.site.id) || claimedStations.has(p.station.id)) continue;
			matched.push(p);
			claimedSites.add(p.site.id);
			claimedStations.add(p.station.id);
		}
	};
	pairUp(maxM, () => true);
	if (sameName) {
		pairUp(
			sameName.maxM,
			(site, st) => compareSiteNames(sameName.siteName(site), sameName.stationName(st)) === 'same'
		);
	}

	return {
		matched,
		toInsert: sites.filter((s) => !claimedSites.has(s.id)),
		unclaimed: existing.filter((e) => !claimedStations.has(e.id))
	};
}
