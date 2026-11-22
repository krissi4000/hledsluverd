import * as m from '$lib/paraglide/messages';
import { ageParts, formatDate, showRelativeAge } from './format';

/** "rétt í þessu", "fyrir 3 mín", "fyrir 2 klst", "fyrir 1 degi" (age_d picks the plural). */
export function ageText(at: Date, now = new Date()): string {
	const p = ageParts(at, now);
	if (p.unit === 'min') return p.n === 0 ? m.age_now() : m.age_min({ n: p.n });
	if (p.unit === 'h') return m.age_h({ n: p.n });
	return m.age_d({ n: p.n });
}

/** "staðfest fyrir 2 klst" while recent, "staðfest 5.11.2026" after a few days. */
export function verifiedText(at: Date, now = new Date()): string {
	return showRelativeAge(at, now)
		? m.verified_ago({ age: ageText(at, now) })
		: m.verified_on({ date: formatDate(at) });
}

/** Live availability's age: "uppfært fyrir 3 mín". */
export function updatedText(at: Date, now = new Date()): string {
	return m.avail_updated({ age: ageText(at, now) });
}
