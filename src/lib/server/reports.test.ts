import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../tests/helpers/db';
import type { Db } from './db/client';
import { networks, reports, stations } from './db/schema';
import {
	COMMENT_MAX,
	createRateLimiter,
	openReports,
	parseReportForm,
	reportNtfyMessage,
	resolveReport,
	submitReport
} from './reports';

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

describe('parseReportForm', () => {
	it('accepts a minimal report (kind only)', () => {
		expect(parseReportForm(form({ kind: 'closed' }))).toEqual({
			ok: true,
			value: { kind: 'closed', correctPriceIsk: null, comment: null, email: null }
		});
	});

	it('parses an Icelandic decimal price, trims text, keeps the email', () => {
		const r = parseReportForm(
			form({ kind: 'price', correctPrice: '52,5', comment: '  hækkaði í gær ', email: 'a@b.is' })
		);
		expect(r).toEqual({
			ok: true,
			value: { kind: 'price', correctPriceIsk: 52.5, comment: 'hækkaði í gær', email: 'a@b.is' }
		});
	});

	it('flags a filled honeypot as spam', () => {
		expect(parseReportForm(form({ kind: 'price', website: 'http://spam' }))).toEqual({
			ok: false,
			reason: 'spam'
		});
	});

	it('rejects unknown kinds, junk prices, bad emails and over-long comments', () => {
		const bad: Record<string, string>[] = [
			{},
			{ kind: 'hack' },
			{ kind: 'price', correctPrice: 'fimmtíu' },
			{ kind: 'price', correctPrice: '0' },
			{ kind: 'price', correctPrice: '5000' },
			{ kind: 'price', correctPrice: '-5' },
			{ kind: 'other', email: 'not-an-email' },
			{ kind: 'other', email: 'x'.repeat(250) + '@b.is' },
			{ kind: 'other', comment: 'x'.repeat(COMMENT_MAX + 1) }
		];
		for (const b of bad) expect(parseReportForm(form(b))).toEqual({ ok: false, reason: 'invalid' });
	});

	it('accepts a comment exactly at the limit', () => {
		expect(parseReportForm(form({ kind: 'other', comment: 'x'.repeat(COMMENT_MAX) })).ok).toBe(
			true
		);
	});
});

describe('createRateLimiter', () => {
	it('allows `limit` hits per key per window, then refuses', () => {
		const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
		expect(rl.hit('a', 0)).toBe(true);
		expect(rl.hit('a', 10)).toBe(true);
		expect(rl.hit('a', 20)).toBe(false);
		expect(rl.hit('b', 20)).toBe(true);
	});

	it('frees up once old hits leave the window', () => {
		const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
		expect(rl.hit('a', 0)).toBe(true);
		expect(rl.hit('a', 999)).toBe(false);
		expect(rl.hit('a', 1001)).toBe(true);
	});

	it('forgets the oldest key past maxKeys instead of growing forever', () => {
		const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
		rl.hit('a', 0);
		rl.hit('b', 0);
		rl.hit('c', 0); // evicts 'a'
		expect(rl.hit('a', 1)).toBe(true);
	});
});

describe('reportNtfyMessage', () => {
	it('names the station, network, kind and suggested price', () => {
		const msg = reportNtfyMessage(
			{ name: 'Baulan', networkName: 'ON' },
			{ kind: 'price', correctPriceIsk: 59, comment: 'skiltið segir 59', email: 'a@b.is' }
		);
		expect(msg).toContain('rangt verð — Baulan (ON)');
		expect(msg).toContain('59 kr/kWh');
		expect(msg).toContain('skiltið segir 59');
		// the email stays in the database, not in a push notification
		expect(msg).not.toContain('a@b.is');
	});
});

describe.skipIf(!TEST_DB_URL)('reports (db)', () => {
	let db: Db;
	const deps = () => ({
		perIp: createRateLimiter({ limit: 2, windowMs: 60_000 }),
		global: createRateLimiter({ limit: 100, windowMs: 60_000 }),
		ntfyTopic: 'test-topic',
		notify: vi.fn(async () => {})
	});

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on' }).returning();
		await db.insert(stations).values([
			{ networkId: n.id, slug: 'baulan', name: 'Baulan', location: { x: -21.6, y: 64.7 } },
			{
				networkId: n.id,
				slug: 'lokud',
				name: 'Lokuð',
				location: { x: -21.6, y: 64.7 },
				isActive: false
			}
		]);
	});

	it('stores an open report and pushes ntfy', async () => {
		const d = deps();
		const res = await submitReport(
			db,
			'baulan',
			form({ kind: 'price', correctPrice: '59' }),
			'1.2.3.4',
			d
		);
		expect(res).toBe('ok');
		const rows = await db.select().from(reports);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'price', correctPriceIsk: 59, status: 'open' });
		expect(d.notify).toHaveBeenCalledWith('test-topic', expect.stringContaining('Baulan'));
	});

	it('honeypot: answers ok, stores and pushes nothing', async () => {
		const d = deps();
		const res = await submitReport(
			db,
			'baulan',
			form({ kind: 'price', website: 'x' }),
			'1.2.3.4',
			d
		);
		expect(res).toBe('ok');
		expect(await db.select().from(reports)).toHaveLength(0);
		expect(d.notify).not.toHaveBeenCalled();
	});

	it('rate-limits per IP', async () => {
		const d = deps();
		const f = () => form({ kind: 'other' });
		expect(await submitReport(db, 'baulan', f(), '1.2.3.4', d)).toBe('ok');
		expect(await submitReport(db, 'baulan', f(), '1.2.3.4', d)).toBe('ok');
		expect(await submitReport(db, 'baulan', f(), '1.2.3.4', d)).toBe('rate_limited');
		expect(await submitReport(db, 'baulan', f(), '5.6.7.8', d)).toBe('ok');
		expect(await db.select().from(reports)).toHaveLength(3);
	});

	it('rejects invalid input and unknown or inactive stations', async () => {
		const d = deps();
		expect(await submitReport(db, 'baulan', form({ kind: 'x' }), 'a', d)).toBe('invalid');
		expect(await submitReport(db, 'engin', form({ kind: 'other' }), 'b', d)).toBe('not_found');
		expect(await submitReport(db, 'lokud', form({ kind: 'other' }), 'c', d)).toBe('not_found');
		expect(await db.select().from(reports)).toHaveLength(0);
	});

	it('keeps the report when the push fails', async () => {
		const d = { ...deps(), notify: vi.fn(async () => Promise.reject(new Error('down'))) };
		expect(await submitReport(db, 'baulan', form({ kind: 'closed' }), 'a', d)).toBe('ok');
		expect(await db.select().from(reports)).toHaveLength(1);
	});

	it('lists open reports with their station, and resolves them once', async () => {
		const d = deps();
		await submitReport(db, 'baulan', form({ kind: 'closed', comment: 'lokað' }), 'a', d);
		const open = await openReports(db);
		expect(open).toHaveLength(1);
		expect(open[0]).toMatchObject({
			kind: 'closed',
			comment: 'lokað',
			stationName: 'Baulan',
			stationSlug: 'baulan',
			networkName: 'ON'
		});
		expect(await resolveReport(db, open[0].id)).toBe(true);
		expect(await resolveReport(db, open[0].id)).toBe(false);
		expect(await openReports(db)).toHaveLength(0);
		const [row] = await db.select().from(reports);
		expect(row.status).toBe('resolved');
		expect(row.resolvedAt).not.toBeNull();
	});
});
