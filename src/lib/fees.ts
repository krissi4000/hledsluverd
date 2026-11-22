// Per-minute fees, in the one wording the whole site uses (cards, station page, list and
// the link previews).

import * as m from '$lib/paraglide/messages';
import type { Locale } from '$lib/paraglide/runtime';
import { formatNumber, noBreak } from './format';

/** When a fee starts: whole hours as hours ("1 klst"), anything else in minutes ("45 mín"). */
export function feeStartText(afterMin: number, locale?: Locale): string {
	const opts = locale ? { locale } : undefined;
	return afterMin % 60 === 0
		? m.duration_h({ h: formatNumber(afterMin / 60) }, opts)
		: m.duration_min({ n: afterMin }, opts);
}

/**
 * "+ 0,5 kr/mín" for a fee from the first minute, "+ 64 kr/mín eftir 1 klst" for one that
 * only starts later (an overstay fee). Null when there is no fee.
 */
export function minuteFeeText(
	fee: number | null,
	afterMin: number | null,
	locale?: Locale
): string | null {
	if (!fee) return null;
	const opts = locale ? { locale } : undefined;
	if (!afterMin) return noBreak(m.minute_fee({ fee: formatNumber(fee) }, opts));
	const words = m
		.minute_fee_after({ fee: formatNumber(fee), after: feeStartText(afterMin, locale) }, opts)
		.split(' ');
	// "+ 64 kr/mín" and "eftir 1 klst" each stay whole; a narrow column breaks between them
	return `${noBreak(words.slice(0, -3).join(' '))} ${noBreak(words.slice(-3).join(' '))}`;
}
