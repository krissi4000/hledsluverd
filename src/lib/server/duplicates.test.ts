import { describe, expect, it } from 'vitest';
import {
	duplicateReasons,
	findDuplicateCandidates,
	likelyDuplicateOf,
	mergeExternalIds,
	pairKey,
	type DuplicateStation
} from './duplicates';

// Real rows from the prod DB (2026-11), ids and coordinates as stored.
const N1 = 3;
const ISORKA = 2;
const ORKAN = 5;
const hvolsA: DuplicateStation = {
	id: 60,
	networkId: N1,
	name: 'Hvolsvöllur (N1)',
	lat: 63.74979,
	lng: -20.2346,
	externalIds: { n1: '8210_service', ocm: 174284, tomtom: 'a721' }
};
const hvolsB: DuplicateStation = {
	id: 63,
	networkId: N1,
	name: 'Hvolsvöllur (N1)',
	lat: 63.74978,
	lng: -20.23522,
	externalIds: { n1: '8210_service', ocm: 173807, tomtom: 'a721' }
};
const isafA: DuplicateStation = {
	id: 46,
	networkId: N1,
	name: 'Ísafjörður (N1)',
	lat: 66.07465,
	lng: -23.12441,
	externalIds: { n1: '4120_service', ocm: 174335, tomtom: '0df2' }
};
const isafB: DuplicateStation = {
	id: 75,
	networkId: N1,
	name: 'N1 Ísafirði',
	lat: 66.07465,
	lng: -23.12333,
	externalIds: { n1: '4120_service', ocm: 112849, tomtom: '0df2' }
};
const klausturOcm: DuplicateStation = {
	id: 37,
	networkId: ISORKA,
	name: 'Ísorka - Olís Kirkjubæjarklaustur',
	lat: 63.79373,
	lng: -18.04256,
	externalIds: { ocm: 243509 }
};
const klausturVirta: DuplicateStation = {
	id: 254,
	networkId: ISORKA,
	name: 'Ísorka - Olís Kirkjubæjarklaustur',
	lat: 63.79465,
	lng: -18.03846,
	externalIds: { virta: 181839 }
};
// Two Virta sites at one address (AC posts and DC posts): Virta lists them apart.
const reitirAc: DuplicateStation = {
	id: 171,
	networkId: ISORKA,
	name: 'Reitir - Sunnumörk',
	lat: 64.0012,
	lng: -21.1876,
	externalIds: { virta: 1001 }
};
const reitirDc: DuplicateStation = {
	...reitirAc,
	id: 213,
	name: 'Reitir - Sunnumörk - Hraðhleðsla',
	externalIds: { virta: 1002 }
};
const miklaN: DuplicateStation = {
	id: 108,
	networkId: ORKAN,
	name: 'Miklabraut Norður (Orkan)',
	lat: 64.1318,
	lng: -21.8771,
	externalIds: { ocm: 1 }
};
const miklaS: DuplicateStation = {
	id: 109,
	networkId: ORKAN,
	name: 'Miklabraut Suður (Orkan)',
	lat: 64.1311,
	lng: -21.8762,
	externalIds: { ocm: 2 }
};

describe('duplicateReasons', () => {
	it('flags OCM re-imports that share the N1 and TomTom ids', () => {
		const r = duplicateReasons(hvolsA, hvolsB)!;
		expect(r.distanceM).toBeGreaterThan(25);
		expect(r.distanceM).toBeLessThan(35);
		expect(r.reasons).toEqual([
			{ kind: 'shared-id', key: 'n1' },
			{ kind: 'shared-id', key: 'tomtom' },
			{ kind: 'same-name' }
		]);
	});
	it('flags differently titled copies through the shared ids', () => {
		const r = duplicateReasons(isafA, isafB)!;
		expect(r.reasons.map((x) => x.kind)).toEqual(['shared-id', 'shared-id', 'similar-name']);
	});
	it('flags an OCM row and a Virta row of one site 226 m apart by their identical name', () => {
		const r = duplicateReasons(klausturOcm, klausturVirta)!;
		expect(Math.round(r.distanceM)).toBeGreaterThan(200);
		expect(r.reasons).toEqual([{ kind: 'same-name' }]);
	});
	it('flags two rows of one network that match:google stamped with the same place', () => {
		const a: DuplicateStation = {
			id: 1,
			networkId: ORKAN,
			name: 'Orkan Glæsibær',
			lat: 64.14,
			lng: -21.87,
			externalIds: { google: 'ChIJ-glaesibaer' }
		};
		// ~111 m apart and differently named: only the shared place id ties them
		const b: DuplicateStation = { ...a, id: 2, name: 'Hraðhleðsla Álfheimum', lat: 64.141 };
		expect(duplicateReasons(a, b)?.reasons).toEqual([{ kind: 'shared-id', key: 'google' }]);
	});
	it('never pairs sites the source itself lists apart', () => {
		expect(duplicateReasons(reitirAc, reitirDc)).toBeNull();
	});
	it('leaves different names apart beyond the same-spot radius', () => {
		expect(duplicateReasons(miklaN, miklaS)).toBeNull();
	});
	it('needs the same network', () => {
		expect(duplicateReasons(hvolsA, { ...hvolsB, networkId: ISORKA })).toBeNull();
	});
	it('needs a similar name to be within 100 m', () => {
		const far = { ...isafB, externalIds: {}, lat: isafA.lat + 0.0018 }; // ~200 m north
		expect(duplicateReasons(isafA, far)).toBeNull();
	});
	it('flags any two stations of a network at practically the same spot', () => {
		const other = { ...miklaS, name: 'Kringlan', lat: miklaN.lat, lng: miklaN.lng + 0.0001 };
		expect(duplicateReasons(miklaN, other)!.reasons).toEqual([{ kind: 'same-spot' }]);
	});
});

describe('findDuplicateCandidates', () => {
	const all = [hvolsA, hvolsB, isafA, isafB, klausturOcm, klausturVirta, reitirAc, reitirDc];
	it('lists every duplicate pair once, lower id first, strongest evidence first', () => {
		const c = findDuplicateCandidates(all);
		expect(c.map((x) => [x.a.id, x.b.id])).toEqual([
			[60, 63],
			[46, 75],
			[37, 254]
		]);
	});
	it('skips dismissed pairs', () => {
		const c = findDuplicateCandidates(all, new Set([pairKey(254, 37)]));
		expect(c.map((x) => x.a.id)).toEqual([60, 46]);
	});
});

describe('likelyDuplicateOf', () => {
	it('finds the station a new OCM draft would duplicate', () => {
		const draft = { ...hvolsB, id: -1, externalIds: { ocm: 173807 } };
		expect(likelyDuplicateOf(draft, [isafA, hvolsA])?.station.id).toBe(60);
	});
	it('returns null for a new site', () => {
		const draft = { ...hvolsB, id: -1, name: 'Hella (N1)', lat: 63.83, externalIds: {} };
		expect(likelyDuplicateOf(draft, [isafA, hvolsA])).toBeNull();
	});
});

describe('mergeExternalIds', () => {
	it('moves ids the survivor lacks and drops ones it already has', () => {
		expect(
			mergeExternalIds(
				{ ocm: 174284, n1: '8210_service' },
				{ ocm: 173807, n1: '8210_service', tomtom: 'a721' }
			)
		).toEqual({
			survivor: { ocm: 174284, n1: '8210_service', tomtom: 'a721' },
			merged: { ocm: 173807 }
		});
	});
	it('never moves the OCM id, so seed:ocm keeps finding the merged station', () => {
		expect(mergeExternalIds({ virta: 181839 }, { ocm: 243509 })).toEqual({
			survivor: { virta: 181839 },
			merged: { ocm: 243509 }
		});
	});
	it('keeps a conflicting id on the merged station', () => {
		expect(mergeExternalIds({ tomtom: 'x' }, { tomtom: 'y' })).toEqual({
			survivor: { tomtom: 'x' },
			merged: { tomtom: 'y' }
		});
	});
});
