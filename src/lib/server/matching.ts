import type { ConnectorType, TariffKey } from '$lib/types';

export function deriveTariffKey(
	type: ConnectorType,
	powerKw: number,
	networkTariffs: ReadonlySet<TariffKey>
): TariffKey {
	if (type === 'Type2') return 'AC';
	if (powerKw >= 150 && networkTariffs.has('DC_150')) return 'DC_150';
	return 'DC';
}

// Brand and charging words every station of a network shares: they say nothing about
// *which* site a name means ("Ísorka - Olís Vík" vs "Vík í Mýrdal (N1)").
const GENERIC_NAME_WORDS = new Set([
	'n1',
	'on',
	'orkan',
	'ísorka',
	'isorka',
	'olís',
	'olis',
	'tesla',
	'e1',
	'orka',
	'náttúrunnar',
	'supercharger',
	'hleðsla',
	'hraðhleðsla',
	'hverfahleðsla',
	'hleðslustöð'
]);

/** The words of a station name that identify the site: lowercased, brand words dropped. */
export function siteNameWords(name: string): string[] {
	const words = name
		.toLowerCase()
		.normalize('NFC')
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w && !GENERIC_NAME_WORDS.has(w) && (w.length >= 2 || /\d/.test(w)));
	return [...new Set(words)];
}

function commonPrefix(a: string, b: string): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

function bigrams(w: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
	return out;
}

/** Dice coefficient over character bigrams (multiset), 0..1. */
function dice(a: string, b: string): number {
	const ba = bigrams(a);
	const bb = bigrams(b);
	if (ba.length === 0 || bb.length === 0) return 0;
	const pool = [...bb];
	let hits = 0;
	for (const g of ba) {
		const i = pool.indexOf(g);
		if (i >= 0) {
			hits++;
			pool.splice(i, 1);
		}
	}
	return (2 * hits) / (ba.length + bb.length);
}

/**
 * Same word give or take Icelandic declension ("Ísafjörður" ~ "Ísafirði", "Egilsstaðir" ~
 * "Egilsstöðum") or a typo ("Kirkjubæjarklaustri" ~ "Krikjubæjarklaustri"). Numbers
 * must match exactly: "Hlíðasmári 1" is not "Hlíðasmári 6".
 */
function wordsMatch(a: string, b: string): boolean {
	if (a === b) return true;
	if (/\d/.test(a) || /\d/.test(b)) return false;
	const shorter = Math.min(a.length, b.length);
	const p = commonPrefix(a, b);
	if (p >= 4 && p * 2 >= shorter) return true;
	return shorter >= 6 && dice(a, b) >= 0.7;
}

/**
 * How alike two station names are as names of a site:
 * - same: the same identifying words ("Ísorka - Olís Kirkjubæjarklaustur" twice,
 *   "Staðarskáli (N1)" vs "N1 Staðarskáli")
 * - similar: one name's words all appear, loosely, in the other ("Vík (N1)" vs
 *   "Vík í Mýrdal (N1)", "N1 Ísafirði" vs "Ísafjörður (N1)")
 * - different: anything else, including a name with no identifying words at all
 */
export function compareSiteNames(a: string, b: string): 'same' | 'similar' | 'different' {
	const wa = siteNameWords(a);
	const wb = siteNameWords(b);
	if (wa.length === 0 || wb.length === 0) return 'different';
	if (wa.length === wb.length && wa.every((w) => wb.includes(w))) return 'same';
	const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
	return small.every((w) => big.some((x) => wordsMatch(w, x))) ? 'similar' : 'different';
}
