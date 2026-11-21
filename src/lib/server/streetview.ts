// Street View photos of stations for the nearby cards (Google Street View Static API).
//
// Google's terms bind how these may be used:
// - Never on, next to or visually associated with ANY map (EEA terms for projects with an
//   EEA billing address, "No Use With any Map"; the standard terms forbid non-Google
//   maps). So: the nearby cards only, never /kort or /stod (both show a map).
// - Always with the "Google Maps" text attribution right under the image.
// - No caching of imagery: the browser fetches the image from Google itself; the app
//   only hands out a signed URL (route /stod/[slug]/mynd).
// Metadata requests (is there a panorama here?) are free and use no quota; each image
// a browser loads is billed (10 000 a month free, then about $7 per 1 000).
import { createHmac } from 'node:crypto';

export interface StreetViewConfig {
	key: string;
	/** URL signing secret from the Cloud console; recommended, unsigned requests may fail */
	signingSecret?: string;
}

export interface LatLng {
	lat: number;
	lng: number;
}

const ORIGIN = 'https://maps.googleapis.com';
const IMAGE_PATH = '/maps/api/streetview';
const METADATA_PATH = '/maps/api/streetview/metadata';

/** 4:3, twice the largest size a card shows it at (120 × 90), so it stays sharp */
export const PHOTO_WIDTH = 240;
export const PHOTO_HEIGHT = 180;
/** metres around the station to look for a panorama (Google's default is 50): chargers
 * often sit in a car park set back from the road the Street View car drove */
const RADIUS_M = 80;
/** a little narrower than Google's 90° so the station fills more of a small image */
const FOV = 75;
/** images handed out per day unless GOOGLE_STREETVIEW_DAILY_BUDGET says otherwise:
 * about the free 10 000 a month */
export const DEFAULT_DAILY_BUDGET = 300;

/**
 * Google's URL signature: HMAC-SHA1 over path + query, keyed with the base64url-decoded
 * secret, itself base64url-encoded.
 */
export function signPath(pathAndQuery: string, secret: string): string {
	const key = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
	return createHmac('sha1', key)
		.update(pathAndQuery)
		.digest('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function build(path: string, params: Record<string, string>, cfg: StreetViewConfig): string {
	const pathAndQuery = `${path}?${new URLSearchParams({ ...params, key: cfg.key })}`;
	const signature = cfg.signingSecret
		? `&signature=${signPath(pathAndQuery, cfg.signingSecret)}`
		: '';
	return ORIGIN + pathAndQuery + signature;
}

// Outdoor panoramas only: no shop interiors, and no user photo spheres, whose
// indoor/outdoor status Google can't tell.
const near = (at: LatLng) => ({
	location: `${at.lat.toFixed(6)},${at.lng.toFixed(6)}`,
	radius: String(RADIUS_M),
	source: 'outdoor'
});

/**
 * The station seen from the nearest outdoor panorama. With no heading given, Google
 * aims the camera at `location` from where the panorama was taken. return_error_code
 * makes a missing image a 404 instead of Google's grey placeholder.
 */
export function photoUrl(at: LatLng, cfg: StreetViewConfig): string {
	return build(
		IMAGE_PATH,
		{
			...near(at),
			size: `${PHOTO_WIDTH}x${PHOTO_HEIGHT}`,
			fov: String(FOV),
			return_error_code: 'true'
		},
		cfg
	);
}

export function metadataUrl(at: LatLng, cfg: StreetViewConfig): string {
	return build(METADATA_PATH, near(at), cfg);
}

/**
 * Is there an outdoor panorama near the station? Free (no quota). Throws on anything
 * but a clear yes or no (bad key, quota, network), so the caller can retry later.
 */
export async function hasPanorama(
	at: LatLng,
	cfg: StreetViewConfig,
	fetchFn: typeof fetch = fetch
): Promise<boolean> {
	const res = await fetchFn(metadataUrl(at, cfg), { signal: AbortSignal.timeout(4000) });
	if (!res.ok) throw new Error(`Street View metadata: HTTP ${res.status}`);
	const { status } = (await res.json()) as { status?: string };
	if (status === 'OK') return true;
	if (status === 'ZERO_RESULTS' || status === 'NOT_FOUND') return false;
	throw new Error(`Street View metadata: ${status}`);
}

/**
 * An in-process cap on images handed out per UTC day, so a burst of traffic (or a
 * crawler) can't run up the bill. Like the TomTom budget it resets with the process;
 * Google's own daily quota in the Cloud console is the hard backstop.
 */
export function dailyBudget(limit: number, now: () => number = Date.now) {
	let day = '';
	let used = 0;
	return {
		take(): boolean {
			const today = new Date(now()).toISOString().slice(0, 10);
			if (today !== day) {
				day = today;
				used = 0;
			}
			if (used >= limit) return false;
			used++;
			return true;
		}
	};
}
