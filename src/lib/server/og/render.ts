// satori lays the element tree out (flexbox) and turns all text into glyph paths
// using only the fonts passed in, so resvg needs no fonts at all and the output is
// the same on every machine. resvg-js is a prebuilt native binary (no node-gyp,
// cairo or system fonts) and renderAsync rasterises off the event loop.

import satori, { type Font } from 'satori';
import { renderAsync } from '@resvg/resvg-js';
import { OG_HEIGHT, OG_WIDTH, type OgNode } from './templates';

export function renderSvg(node: OgNode, fonts: Font[]): Promise<string> {
	return satori(node, { width: OG_WIDTH, height: OG_HEIGHT, fonts });
}

export async function renderPng(node: OgNode, fonts: Font[]): Promise<Buffer> {
	const svg = await renderSvg(node, fonts);
	const image = await renderAsync(svg, {
		fitTo: { mode: 'original' },
		font: { loadSystemFonts: false }
	});
	return image.asPng();
}
