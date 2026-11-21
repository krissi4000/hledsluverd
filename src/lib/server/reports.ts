// "Tilkynna rangt verð": visitor reports from the station page → reports table + ntfy.
// No captcha: a honeypot field, per-IP and global rate limits and length limits.

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { REPORT_KINDS, networks, reports, stations } from './db/schema';

export type ReportKind = (typeof REPORT_KINDS)[number];

export const COMMENT_MAX = 1000;
export const EMAIL_MAX = 254;
/** The hidden field bots fill in and people never see. */
export const HONEYPOT_FIELD = 'website';
/** A suggested price outside this range is a typo or junk, not a correction. */
const PRICE_MIN = 1;
const PRICE_MAX = 500;

export interface ReportInput {
	kind: ReportKind;
	correctPriceIsk: number | null;
	comment: string | null;
	email: string | null;
}

export type ParsedReport =
	| { ok: true; value: ReportInput }
	/** spam: the honeypot was filled — the caller pretends success and stores nothing */
	| { ok: false; reason: 'invalid' | 'spam' };

function text(form: FormData, key: string): string {
	const v = form.get(key);
	return typeof v === 'string' ? v.trim() : '';
}

/** Validates the station page's report form. Too long is rejected, not cut short. */
export function parseReportForm(form: FormData): ParsedReport {
	if (text(form, HONEYPOT_FIELD) !== '') return { ok: false, reason: 'spam' };

	const kind = text(form, 'kind');
	if (!(REPORT_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'invalid' };

	const rawPrice = text(form, 'correctPrice');
	let correctPriceIsk: number | null = null;
	if (rawPrice !== '') {
		if (!/^\d{1,3}([.,]\d{1,2})?$/.test(rawPrice)) return { ok: false, reason: 'invalid' };
		correctPriceIsk = Number(rawPrice.replace(',', '.'));
		if (correctPriceIsk < PRICE_MIN || correctPriceIsk > PRICE_MAX) {
			return { ok: false, reason: 'invalid' };
		}
	}

	const comment = text(form, 'comment');
	if (comment.length > COMMENT_MAX) return { ok: false, reason: 'invalid' };

	const email = text(form, 'email');
	if (email.length > EMAIL_MAX) return { ok: false, reason: 'invalid' };
	if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return { ok: false, reason: 'invalid' };
	}

	return {
		ok: true,
		value: {
			kind: kind as ReportKind,
			correctPriceIsk,
			comment: comment || null,
			email: email || null
		}
	};
}

/**
 * Fixed-window-per-key counter kept in process memory: good enough for one node
 * process on one VPS (resets on restart, which is fine for spam protection).
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }) {
	const hits = new Map<string, number[]>();
	const maxKeys = opts.maxKeys ?? 10_000;
	return {
		/** Records an attempt; false when the key is over its limit (the attempt is not counted). */
		hit(key: string, now = Date.now()): boolean {
			const since = now - opts.windowMs;
			const recent = (hits.get(key) ?? []).filter((t) => t > since);
			if (recent.length >= opts.limit) {
				hits.set(key, recent);
				return false;
			}
			recent.push(now);
			hits.delete(key); // re-insert so Map order stays oldest-first for pruning
			hits.set(key, recent);
			if (hits.size > maxKeys) {
				const oldest = hits.keys().next().value;
				if (oldest !== undefined) hits.delete(oldest);
			}
			return true;
		}
	};
}

const KIND_LABEL_IS: Record<ReportKind, string> = {
	price: 'rangt verð',
	closed: 'stöð lokuð',
	availability: 'röng staða',
	other: 'annað'
};

/** The ntfy push for a new report (Icelandic, like the scraper alerts). */
export function reportNtfyMessage(
	station: { name: string; networkName: string },
	r: ReportInput
): string {
	const lines = [`Tilkynning: ${KIND_LABEL_IS[r.kind]} — ${station.name} (${station.networkName})`];
	if (r.correctPriceIsk !== null)
		lines.push(`Rétt verð skv. tilkynningu: ${r.correctPriceIsk} kr/kWh`);
	if (r.comment) lines.push(r.comment.length > 300 ? r.comment.slice(0, 300) + '…' : r.comment);
	return lines.join('\n');
}

export async function createReport(db: Db, stationId: number, r: ReportInput): Promise<number> {
	const [row] = await db
		.insert(reports)
		.values({ stationId, ...r })
		.returning({ id: reports.id });
	return row.id;
}

export interface OpenReport {
	id: number;
	kind: ReportKind;
	correctPriceIsk: number | null;
	comment: string | null;
	email: string | null;
	createdAt: Date;
	stationId: number;
	stationName: string;
	stationSlug: string;
	networkName: string;
}

/** Open reports, newest first, for /admin. */
export async function openReports(db: Db): Promise<OpenReport[]> {
	const rows = await db
		.select({
			id: reports.id,
			kind: reports.kind,
			correctPriceIsk: reports.correctPriceIsk,
			comment: reports.comment,
			email: reports.email,
			createdAt: reports.createdAt,
			stationId: stations.id,
			stationName: stations.name,
			stationSlug: stations.slug,
			networkName: networks.name
		})
		.from(reports)
		.innerJoin(stations, eq(reports.stationId, stations.id))
		.innerJoin(networks, eq(stations.networkId, networks.id))
		.where(eq(reports.status, 'open'))
		.orderBy(desc(reports.createdAt), desc(reports.id));
	return rows;
}

export async function resolveReport(db: Db, id: number): Promise<boolean> {
	const rows = await db
		.update(reports)
		.set({ status: 'resolved', resolvedAt: new Date() })
		.where(and(eq(reports.id, id), eq(reports.status, 'open')))
		.returning({ id: reports.id });
	return rows.length === 1;
}

export type SubmitResult = 'ok' | 'invalid' | 'rate_limited' | 'not_found';

export interface SubmitDeps {
	/** per client IP */
	perIp: ReturnType<typeof createRateLimiter>;
	/** across everyone: caps the damage if the IP can't be told apart (or a botnet tries) */
	global: ReturnType<typeof createRateLimiter>;
	ntfyTopic?: string;
	notify: (topic: string, message: string) => Promise<void>;
}

/**
 * The station page's report action: validate → rate-limit → store → push.
 * A filled honeypot returns 'ok' (bots learn nothing) but stores and pushes nothing.
 * A failed push never loses the report: it is already in the table.
 */
export async function submitReport(
	db: Db,
	slug: string,
	form: FormData,
	clientIp: string,
	deps: SubmitDeps
): Promise<SubmitResult> {
	const parsed = parseReportForm(form);
	if (!parsed.ok) return parsed.reason === 'spam' ? 'ok' : 'invalid';
	if (!deps.perIp.hit(clientIp) || !deps.global.hit('*')) return 'rate_limited';

	const [st] = await db
		.select({ id: stations.id, name: stations.name, networkName: networks.name })
		.from(stations)
		.innerJoin(networks, eq(stations.networkId, networks.id))
		.where(and(eq(stations.slug, slug), eq(stations.isActive, true)));
	if (!st) return 'not_found';

	await createReport(db, st.id, parsed.value);
	if (deps.ntfyTopic) {
		try {
			await deps.notify(deps.ntfyTopic, reportNtfyMessage(st, parsed.value));
		} catch {
			// the report is stored; a lost push must not turn into an error for the visitor
		}
	}
	return 'ok';
}
