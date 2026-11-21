// Fixtures for the link-preview tests (descriptions, og models, rendering).
import type { RateCardEntry, StationDetail } from '../../src/lib/server/db/queries';
import type { ShareContext } from '../../src/lib/server/share';

export const NOW = new Date('2026-11-07T12:00:00Z');
export const FRESH = new Date('2026-11-05T09:00:00Z');
/** more than 30 days before NOW */
export const STALE = new Date('2026-09-03T09:00:00Z');

export function ctx(over: Partial<ShareContext> = {}): ShareContext {
	return { locale: 'is', now: NOW, domain: 'hledsluverd.is', ...over };
}

export function card(
	networkSlug: string,
	networkName: string,
	dc: number | null,
	over: Partial<RateCardEntry> = {}
): RateCardEntry {
	return {
		networkSlug,
		networkName,
		dc,
		dcFrom: false,
		dcVerifiedAt: dc === null ? null : FRESH,
		ac: null,
		acFrom: false,
		acVerifiedAt: null,
		hostLower: false,
		...over
	};
}

type Price = StationDetail['prices'][number];

export function price(mode: 'DC' | 'AC', priceIskPerKwh: number, over: Partial<Price> = {}): Price {
	return {
		mode,
		tariffKey: mode,
		priceIskPerKwh,
		minuteFeeIsk: null,
		minuteFeeAfterMin: null,
		verifiedAt: FRESH,
		...over
	};
}

export function station(over: Partial<StationDetail> = {}): StationDetail {
	return {
		id: 1,
		slug: 'glaesibaer',
		name: 'Glæsibær',
		address: 'Álfheimar 74, Reykjavík',
		lat: 64.14,
		lng: -21.87,
		network: { slug: 'orkan', name: 'Orkan', websiteUrl: null },
		hostPriced: false,
		underConstruction: false,
		connectors: [
			{ type: 'CCS2', powerKw: 150, count: 2 },
			{ type: 'Type2', powerKw: 22, count: 2 }
		],
		prices: [price('DC', 49), price('AC', 30)],
		availability: null,
		stallCount: null,
		tomtomId: null,
		...over
	};
}
