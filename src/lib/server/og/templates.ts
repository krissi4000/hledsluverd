// Layouts for the 1200×630 og:images, as the element trees satori takes (React-
// element shaped objects, no React needed). Pure: everything printed comes from the
// model, so the model's hash identifies the picture. Change anything here →
// bump OG_TEMPLATE_VERSION in model.ts.
//
// Satori subset of CSS: every div with more than one child needs display:flex.

import type { HomeOgModel, HomeOgRow, OgNetwork, StationOgModel } from './model';
import type { PriceView } from '../share';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Family names registered in fonts.ts. Satori falls back across families per glyph. */
export const FONT_FAMILY = 'Inter, Inter Ext';

// app.css tokens
const C = {
	bg: '#f4f6f5',
	surface: '#ffffff',
	text: '#111a15',
	muted: '#5d6b63',
	border: '#e1e7e3',
	accent: '#15803d',
	accentSoft: '#f1faf4',
	stale: '#b45309',
	staleSoft: '#fff8ef'
};

type Style = Record<string, string | number>;
export interface OgNode {
	type: string;
	props: {
		style?: Style;
		children?: OgNode | string | (OgNode | string)[];
		[key: string]: unknown;
	};
}
type Child = OgNode | string | null | false | undefined;

function div(style: Style, ...children: Child[]): OgNode {
	const kids = children.filter((c): c is OgNode | string => !!c);
	return {
		type: 'div',
		props: { style: { display: 'flex', ...style }, children: kids.length === 1 ? kids[0] : kids }
	};
}

function img(src: string, size: number, style: Style = {}): OgNode {
	return {
		type: 'img',
		props: { src, width: size, height: size, style: { objectFit: 'contain', ...style } }
	};
}

/** Single line, cut with an ellipsis. */
function line(style: Style, text: string): OgNode {
	return {
		type: 'div',
		props: {
			style: {
				display: 'block',
				whiteSpace: 'nowrap',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				...style
			},
			children: text
		}
	};
}

const BOLT =
	'data:image/svg+xml;base64,' +
	Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M13.2 2 4.6 13.4h6.1L9.8 22l8.6-11.4h-6.1L13.2 2Z"/></svg>'
	).toString('base64');

/** The header's green lightning tile. */
function brandMark(size: number): OgNode {
	return div(
		{
			width: size,
			height: size,
			borderRadius: size * 0.26,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundImage: 'linear-gradient(145deg, #22a355, #15803d)'
		},
		img(BOLT, Math.round(size * 0.56))
	);
}

function networkTile(n: OgNetwork, size: number): OgNode {
	const base: Style = {
		width: size,
		height: size,
		flexShrink: 0,
		borderRadius: size * 0.26,
		alignItems: 'center',
		justifyContent: 'center'
	};
	if (n.logo) {
		return div(
			{ ...base, background: C.surface, border: `2px solid ${C.border}` },
			img(n.logo, Math.round(size * 0.68))
		);
	}
	return div(
		{ ...base, background: n.color, color: '#fff', fontSize: size * 0.4, fontWeight: 800 },
		n.initials
	);
}

function header(site: string, domain: string): OgNode {
	return div(
		{ justifyContent: 'space-between', alignItems: 'center' },
		div(
			{ alignItems: 'center', gap: 16 },
			brandMark(52),
			div({ fontSize: 38, fontWeight: 800, letterSpacing: -1 }, site)
		),
		div({ fontSize: 26, fontWeight: 600, color: C.accent }, domain)
	);
}

function frame(...children: Child[]): OgNode {
	return div(
		{
			width: OG_WIDTH,
			height: OG_HEIGHT,
			// satori sizes are content-box by default; padding must not grow the canvas
			boxSizing: 'border-box',
			flexDirection: 'column',
			padding: '44px 60px',
			background: C.bg,
			color: C.text,
			fontFamily: FONT_FAMILY
		},
		...children
	);
}

function homeRow(r: HomeOgRow, cheapestLabel: string, height: number): OgNode {
	return div(
		{
			alignItems: 'center',
			height,
			padding: '0 28px',
			borderRadius: 16,
			background: r.cheapest ? C.accentSoft : C.surface,
			border: `2px solid ${r.cheapest ? C.accent : C.border}`
		},
		networkTile(r.network, 48),
		div(
			{ flexDirection: 'column', flexGrow: 1, marginLeft: 20, minWidth: 0 },
			div(
				{ alignItems: 'center', gap: 14 },
				div({ fontSize: 30, fontWeight: 600 }, r.network.name),
				r.ownBrand && div({ fontSize: 20, color: C.muted }, r.ownBrand),
				r.cheapest &&
					div(
						{
							fontSize: 17,
							fontWeight: 800,
							letterSpacing: 0.5,
							textTransform: 'uppercase',
							color: '#fff',
							background: C.accent,
							borderRadius: 999,
							padding: '3px 12px'
						},
						cheapestLabel
					)
			),
			r.stale && line({ fontSize: 20, color: C.stale, marginTop: 2 }, r.stale)
		),
		div(
			{
				fontSize: 40,
				fontWeight: 800,
				letterSpacing: -1,
				marginLeft: 24,
				// own-brand prices are listed, not promoted; stale ones are amber like on the site
				color: r.stale ? C.stale : r.ownBrand ? C.muted : C.text
			},
			r.price
		)
	);
}

export function homeTree(mo: HomeOgModel): OgNode {
	return frame(
		header(mo.site, mo.domain),
		div(
			{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 30 },
			div({ fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }, mo.heading),
			div({ fontSize: 26, fontWeight: 600, color: C.muted }, mo.date)
		),
		mo.empty
			? div(
					{
						flexGrow: 1,
						alignItems: 'center',
						justifyContent: 'center',
						fontSize: 40,
						color: C.muted
					},
					mo.empty
				)
			: div(
					// five rows only fit a little tighter
					{ flexDirection: 'column', gap: mo.rows.length > 4 ? 10 : 12, marginTop: 20 },
					...mo.rows.map((r) => homeRow(r, mo.cheapestLabel, mo.rows.length > 4 ? 66 : 76))
				)
	);
}

function pricePanel(p: PriceView, mo: StationOgModel): OgNode {
	const known = p.price !== null;
	const verified = p.verified && (p.stale ? `${p.verified} · ${mo.staleNote}` : p.verified);
	return div(
		{
			flexDirection: 'column',
			padding: '18px 28px',
			borderRadius: 20,
			background: p.stale ? C.staleSoft : C.surface,
			border: `2px solid ${p.stale ? C.stale : C.border}`
		},
		div({ fontSize: 24, fontWeight: 600, color: C.muted }, p.label),
		div(
			{
				fontSize: 56,
				fontWeight: 800,
				letterSpacing: -1.5,
				lineHeight: 1.15,
				color: !known ? C.muted : p.stale ? C.stale : C.text
			},
			known ? p.price! : '—'
		),
		!known && div({ fontSize: 22, color: C.muted }, mo.priceUnknown),
		p.fee && div({ fontSize: 24, fontWeight: 600 }, p.fee),
		p.ownBrand && div({ fontSize: 20, color: C.muted }, p.ownBrand),
		// wraps rather than truncating: the stale warning must be readable in full
		verified &&
			div(
				{ fontSize: 20, lineHeight: 1.3, color: p.stale ? C.stale : C.muted, marginTop: 2 },
				verified
			)
	);
}

export function stationTree(mo: StationOgModel): OgNode {
	return frame(
		header(mo.site, mo.domain),
		div(
			{ flexGrow: 1, marginTop: 30, gap: 40, minHeight: 0 },
			// left: who and where
			div(
				{ flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0 },
				div(
					{ alignItems: 'center', gap: 16 },
					networkTile(mo.network, 52),
					line({ fontSize: 30, fontWeight: 600, color: C.muted }, mo.network.name)
				),
				{
					type: 'div',
					props: {
						style: {
							display: 'block',
							marginTop: 18,
							fontSize: 58,
							fontWeight: 800,
							letterSpacing: -1.5,
							lineHeight: 1.1,
							lineClamp: 3
						},
						children: mo.name
					}
				},
				mo.address && line({ fontSize: 26, color: C.muted, marginTop: 12 }, mo.address),
				div({ flexGrow: 1 }),
				mo.connectors.length > 0 &&
					div(
						{ flexDirection: 'column', gap: 10 },
						div({ fontSize: 20, fontWeight: 600, color: C.muted }, mo.connectorsLabel),
						div(
							{ flexWrap: 'wrap', gap: 10 },
							...mo.connectors.map((c) =>
								div(
									{
										fontSize: 24,
										fontWeight: 600,
										padding: '6px 16px',
										borderRadius: 999,
										background: C.surface,
										border: `2px solid ${C.border}`
									},
									c
								)
							)
						)
					)
			),
			// right: what it costs
			div(
				{ flexDirection: 'column', width: 450, flexShrink: 0, gap: 16 },
				...(mo.prices.length
					? mo.prices.map((p) => pricePanel(p, mo))
					: [
							pricePanel(
								{
									mode: 'DC',
									label: mo.priceUnknown,
									price: null,
									fee: null,
									ownBrand: null,
									verified: null,
									stale: false
								},
								{ ...mo, priceUnknown: '' }
							)
						]),
				mo.hostPriced && div({ fontSize: 20, color: C.muted, lineHeight: 1.3 }, mo.hostPriced)
			)
		)
	);
}

/** static/og-fallback.png: no data, so nothing in it can go stale. */
export function fallbackTree(mo: { site: string; tagline: string; domain: string }): OgNode {
	return frame(
		div(
			{ flexGrow: 1, flexDirection: 'column', justifyContent: 'center', paddingLeft: 24 },
			div(
				{ alignItems: 'center', gap: 32 },
				brandMark(120),
				div({ fontSize: 96, fontWeight: 800, letterSpacing: -3 }, mo.site)
			),
			div(
				{ marginTop: 36, fontSize: 40, fontWeight: 600, color: C.muted, maxWidth: 1000 },
				mo.tagline
			)
		),
		div({ justifyContent: 'flex-end', fontSize: 30, fontWeight: 600, color: C.accent }, mo.domain)
	);
}
