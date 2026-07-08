export interface LatLng {
	lat: number;
	lng: number;
}

const R_KM = 6371;

/** Great-circle distance (haversine) — accurate to ~0.5%, plenty for sorting stations. */
export function haversineKm(a: LatLng, b: LatLng): number {
	const rad = (d: number) => (d * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const s =
		Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R_KM * Math.asin(Math.sqrt(s));
}

export function formatKm(km: number): string {
	return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}
