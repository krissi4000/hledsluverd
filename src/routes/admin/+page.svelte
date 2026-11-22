<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatNumber, isStale } from '$lib/format';

	const kindLabel: Record<string, () => string> = {
		price: () => m.report_kind_price(),
		closed: () => m.report_kind_closed(),
		availability: () => m.report_kind_availability(),
		other: () => m.report_kind_other()
	};
	import { TARIFF_KEYS } from '$lib/types';

	let { data, form } = $props();
</script>

<h2>{m.admin_title()}</h2>

{#if form?.saved}<p class="ok">{m.admin_saved()}</p>{/if}
{#if form?.error}<p class="err">{form.error}</p>{/if}

<section aria-label={m.admin_reports()}>
	<h3>{m.admin_reports()} ({data.reports.length})</h3>
	{#if data.reports.length === 0}
		<p class="muted">{m.admin_no_reports()}</p>
	{:else}
		<table class="surface" data-testid="admin-reports">
			<tbody>
				{#each data.reports as r (r.id)}
					<tr>
						<td class="nowrap">{r.createdAt.toLocaleString('is-IS')}</td>
						<td
							><a href="/stod/{r.stationSlug}">{r.stationName}</a>
							<span class="muted">· {r.networkName}</span></td
						>
						<td>
							<strong>{kindLabel[r.kind]()}</strong
							>{#if r.correctPriceIsk !== null}{' · '}{formatNumber(r.correctPriceIsk)} kr/kWh{/if}
							{#if r.comment}<div class="msg">{r.comment}</div>{/if}
							{#if r.email}<div class="msg"><a href="mailto:{r.email}">{r.email}</a></div>{/if}
						</td>
						<td class="actions">
							<a class="btn btn-sm" href="/admin?stod={r.stationId}#price-form"
								>{m.admin_report_price_form()}</a
							>
							<form method="POST" action="?/resolveReport">
								<input type="hidden" name="reportId" value={r.id} />
								<button class="btn btn-sm">{m.admin_resolve()}</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section aria-label={m.admin_scrapers()}>
	<h3>{m.admin_scrapers()}</h3>
	<table class="surface" data-testid="admin-health">
		<tbody>
			{#each data.health as h (h.networkSlug)}
				<tr>
					<td>{h.networkName}</td>
					<td class:bad={h.lastStatus === 'failed'}>
						{#if h.lastRunAt}
							{h.lastStatus} — {m.admin_last_run()}: {h.lastRunAt.toLocaleString('is-IS')}
						{:else}
							{m.admin_never_ran()}
						{/if}
					</td>
					<td>
						{#if h.consecutiveFailures >= 3}<strong class="bad"
								>{m.admin_failures({ n: h.consecutiveFailures })}</strong
							>{:else if h.consecutiveFailures > 0}{m.admin_failures({
								n: h.consecutiveFailures
							})}{/if}
					</td>
					<td class="msg">{h.lastMessage ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section aria-label={m.admin_prices()}>
	<h3>{m.admin_prices()}</h3>
	<table class="surface" data-testid="admin-prices">
		<tbody>
			{#each data.prices as p (p.id)}
				<tr>
					<td>{p.networkName}</td>
					<td>{p.stationName ?? m.admin_network_wide()}</td>
					<td>{p.tariffKey}</td>
					<td>
						{formatNumber(p.priceIskPerKwh)} kr{#if p.minuteFeeIsk}
							+ {formatNumber(p.minuteFeeIsk)} kr/mín{#if p.minuteFeeAfterMin}
								({p.minuteFeeAfterMin} mín){/if}{/if}
					</td>
					<td class:stale={isStale(p.verifiedAt)}>{formatDate(p.verifiedAt)}</td>
					<td>
						<form method="POST" action="?/verify">
							<input type="hidden" name="priceId" value={p.id} />
							<button class="btn btn-sm">{m.admin_verify()}</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h3 id="price-form">{m.admin_add_price()}</h3>
	<form method="POST" action="?/price" class="grid surface" data-testid="admin-price-form">
		<label
			>{m.th_network()}
			<select name="networkId" required>
				{#each data.networks as n (n.id)}<option
						value={n.id}
						selected={n.id === data.preselect?.networkId}>{n.name}</option
					>{/each}
			</select>
		</label>
		<label
			>{m.admin_station_optional()}
			<select name="stationId">
				<option value=""></option>
				{#each data.stations as s (s.id)}<option
						value={s.id}
						selected={s.id === data.preselect?.stationId}>{s.networkName} — {s.name}</option
					>{/each}
			</select>
		</label>
		<label
			>{m.admin_tariff()}
			<select name="tariffKey" required>
				{#each TARIFF_KEYS as t (t)}<option value={t}>{t}</option>{/each}
			</select>
		</label>
		<label>{m.admin_price_kwh()} <input name="price" required inputmode="decimal" /></label>
		<label>{m.admin_minute_fee()} <input name="minuteFee" inputmode="decimal" /></label>
		<label>{m.admin_fee_after()} <input name="minuteFeeAfterMin" inputmode="numeric" /></label>
		<button class="btn btn-primary">{m.admin_save()}</button>
	</form>
</section>

<section aria-label={m.admin_stations()}>
	<h3>{m.admin_stations()}</h3>
	<table class="surface" data-testid="admin-stations">
		<tbody>
			{#each data.stations as s (s.id)}
				<tr class:inactive={!s.isActive}>
					<td>{s.networkName}</td>
					<td>{s.name}</td>
					<td>
						<form method="POST" action="?/stationActive">
							<input type="hidden" name="stationId" value={s.id} />
							<input type="hidden" name="isActive" value={String(!s.isActive)} />
							<button class="btn btn-sm"
								>{s.isActive ? m.admin_deactivate() : m.admin_activate()}</button
							>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		overflow: hidden;
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
	}
	td {
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--border);
		vertical-align: middle;
	}
	tr:first-child td {
		border-top: none;
	}
	form {
		margin: 0;
	}
	.bad {
		color: var(--danger);
		font-weight: 600;
	}
	.stale {
		color: var(--stale);
		font-weight: 600;
	}
	.msg {
		font-size: 0.8rem;
		opacity: 0.7;
		max-width: 24rem;
	}
	.nowrap {
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		justify-content: flex-end;
		align-items: center;
	}
	.inactive {
		opacity: 0.45;
	}
	.grid {
		padding: 1rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
		align-items: end;
		max-width: 60rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	.ok,
	.err {
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}
	.ok {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.err {
		background: #fdecec;
		color: var(--danger);
	}
</style>
