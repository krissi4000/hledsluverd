// Regenerates static/og-fallback.png, the share image for pages without their own
// and what /og/*.png serve when rendering fails. It shows no prices, so it never
// goes stale. Rerun after changing fallbackTree or the brand:
//   npm run og:fallback
import { readFileSync, writeFileSync } from 'node:fs';
import type { Font } from 'satori';
import * as m from '../src/lib/paraglide/messages.js';
import { renderPng } from '../src/lib/server/og/render';
import { fallbackTree } from '../src/lib/server/og/templates';
import { DEFAULT_SITE_ORIGIN } from '../src/lib/server/site';

// same files and families as src/lib/server/og/fonts.ts (which uses Vite's ?inline)
const font = (file: string, name: string, weight: Font['weight']): Font => ({
	name,
	weight,
	style: 'normal',
	data: readFileSync(new URL(`../src/lib/server/og/fonts/${file}`, import.meta.url))
});
const fonts = [
	font('inter-latin-400-normal.woff', 'Inter', 400),
	font('inter-latin-600-normal.woff', 'Inter', 600),
	font('inter-latin-800-normal.woff', 'Inter', 800),
	font('inter-latin-ext-400-normal.woff', 'Inter Ext', 400),
	font('inter-latin-ext-800-normal.woff', 'Inter Ext', 800)
];

const locale = 'is'; // crawlers send no locale cookie, so they always see Icelandic
const png = await renderPng(
	fallbackTree({
		site: m.site_title({}, { locale }),
		tagline: m.site_tagline({}, { locale }),
		domain: new URL(DEFAULT_SITE_ORIGIN).host
	}),
	fonts
);
const out = new URL('../static/og-fallback.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes)`);
