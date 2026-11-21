import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STALE, card, ctx, price, station } from '../../../../tests/helpers/share';
import { ogFonts } from './fonts';
import { homeOgModel, stationOgModel } from './model';
import { renderPng, renderSvg } from './render';
import {
	FONT_FAMILY,
	OG_HEIGHT,
	OG_WIDTH,
	fallbackTree,
	homeTree,
	stationTree,
	type OgNode
} from './templates';

const ICELANDIC = 'áéíóúýðþæöÁÉÍÓÚÝÐÞÆÖ';

function text(t: string, fontWeight: number): OgNode {
	return {
		type: 'div',
		props: {
			style: { display: 'flex', fontFamily: FONT_FAMILY, fontSize: 48, fontWeight },
			children: t
		}
	};
}

/** satori draws text as <path d>; a glyph a font lacks becomes its .notdef box */
async function glyphPath(ch: string, weight: number): Promise<string> {
	const svg = await renderSvg(text(ch, weight), ogFonts());
	const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
	expect(paths, `one path for ${ch}`).toHaveLength(1);
	return paths[0];
}

function pngSize(png: Uint8Array): { width: number; height: number } {
	expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) }; // IHDR
}

// OG_PREVIEW_DIR=/some/dir npx vitest run render  → also writes the PNGs there to look at
function preview(name: string, png: Uint8Array) {
	const dir = process.env.OG_PREVIEW_DIR;
	if (!dir) return;
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), png);
}

describe('og fonts', () => {
	// every weight the templates use: station names are 800, labels 600, notes 400
	for (const weight of [400, 600, 800]) {
		it(`draws every Icelandic letter as a real glyph at weight ${weight}`, async () => {
			const missing = await glyphPath('中', weight); // in none of the embedded fonts
			const paths = await Promise.all([...ICELANDIC].map((ch) => glyphPath(ch, weight)));
			for (const [i, p] of paths.entries()) {
				expect(p, `${ICELANDIC[i]} must not be the missing-glyph box`).not.toBe(missing);
			}
			// and each is its own shape: no letter silently swapped for another
			expect(new Set(paths).size).toBe(ICELANDIC.length);
		});
	}

	it('falls back to the latin-ext family for letters outside Latin-1', async () => {
		const missing = await glyphPath('中', 800);
		expect(await glyphPath('ł', 800)).not.toBe(missing);
	});
});

describe('og rendering', () => {
	it('renders the homepage image at 1200×630', async () => {
		const cards = [
			// worst case for row width: own-brand label and stale warning on one row
			card('tesla', 'Tesla', 27, { dcFrom: true, dcVerifiedAt: STALE }),
			card('orkan', 'Orkan', 49, { dcFrom: true }),
			card('on', 'ON', 62, { dcVerifiedAt: STALE }),
			card('isorka', 'Ísorka', 63, { dcFrom: true }),
			card('nyr', 'Þórshafnar Orka', 70)
		];
		const png = await renderPng(homeTree(homeOgModel(cards, ctx())), ogFonts());
		expect(pngSize(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
		preview('home-5-rows-stale.png', png);
	});

	it('renders a station image with a long Icelandic name at 1200×630', async () => {
		const st = station({
			name: 'Hleðslustöð við Þjóðveg 1 — Kirkjubæjarklaustur, Skaftárhreppur, Suðurland',
			hostPriced: true,
			prices: [
				price('DC', 64, { minuteFeeIsk: 64, minuteFeeAfterMin: 60, verifiedAt: STALE }),
				price('AC', 30)
			]
		});
		const png = await renderPng(stationTree(stationOgModel(st, ctx())), ogFonts());
		expect(pngSize(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
		preview('station-long-stale-host.png', png);
	});

	it('renders a station with no connectors or prices', async () => {
		const png = await renderPng(
			stationTree(stationOgModel(station({ connectors: [], prices: [] }), ctx())),
			ogFonts()
		);
		expect(pngSize(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
	});

	it('renders the fallback image', async () => {
		const png = await renderPng(
			fallbackTree({ site: 'Hleðsluverð', tagline: 'Verð á hleðslu', domain: 'hledsluverd.is' }),
			ogFonts()
		);
		expect(pngSize(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
	});
});
