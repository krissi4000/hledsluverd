// Google's Maps JavaScript API, for the Places UI Kit photos on the /kort station card.
// Loaded the first time a visitor opens a station that has a Google place, never with the
// page: until then nothing is fetched from Google and nothing is billed. Browser only.

const CALLBACK = '__hledsluverdGoogleMaps';

type MapsWindow = Record<string, unknown> & {
	google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
};

let ready: Promise<void> | null = null;

/**
 * Resolves once the Places UI Kit elements (<gmp-place-details-compact> and its children)
 * are defined. Rejects when the script can't load (offline, blocked); a later call tries
 * again. The key is a browser key, locked to this site's address in the Cloud console.
 */
export function loadPlacesUiKit(key: string, language: string): Promise<void> {
	ready ??= new Promise<void>((resolve, reject) => {
		const w = window as unknown as MapsWindow;
		w[CALLBACK] = () => resolve();
		const script = document.createElement('script');
		script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
			key,
			v: 'weekly',
			language,
			region: 'IS',
			loading: 'async',
			callback: CALLBACK
		})}`;
		script.async = true;
		script.onerror = () => {
			script.remove();
			reject(new Error('Google Maps JavaScript API did not load'));
		};
		document.head.append(script);
	})
		.then(async () => {
			const maps = (window as unknown as MapsWindow).google?.maps;
			if (!maps?.importLibrary) throw new Error('Google Maps JavaScript API: no importLibrary');
			await maps.importLibrary('places');
			await customElements.whenDefined('gmp-place-details-compact');
		})
		.catch((e: unknown) => {
			ready = null;
			throw e;
		});
	return ready;
}
