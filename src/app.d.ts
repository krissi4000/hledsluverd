// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SeoMeta } from '$lib/seo';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			/** share/search metadata; +layout.svelte renders it with defaults (src/lib/seo.ts) */
			seo?: SeoMeta;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
