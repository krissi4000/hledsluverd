<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatNumber, isStale } from '$lib/format';
	import { TARIFF_KEYS } from '$lib/types';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>{m.admin_title()} — {m.site_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<h2>{m.admin_title()}</h2>

{#if form?.saved}<p class="ok">{m.admin_saved()}</p>{/if}
{#if form?.error}<p class="err">{form.error}</p>{/if}

<section aria-label={m.admin_scrapers()}>
	<h3>{m.admin_scrapers()}</h3>
	<table data-testid="admin-health">
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
								>{h.consecutiveFailures} {m.admin_failures()}</strong
							>{:else if h.consecutiveFailures > 0}{h.consecutiveFailures} {m.admin_failures()}{/if}
					</td>
					<td class="msg">{h.lastMessage ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section aria-label={m.admin_prices()}>
	<h3>{m.admin_prices()}</h3>
	<table data-testid="admin-prices">
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
							<button>{m.admin_verify()}</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h3>{m.admin_add_price()}</h3>
	<form method="POST" action="?/price" class="grid" data-testid="admin-price-form">
		<label
			>{m.th_network()}
			<select name="networkId" required>
				{#each data.networks as n (n.id)}<option value={n.id}>{n.name}</option>{/each}
			</select>
		</label>
		<label
			>{m.admin_station_optional()}
			<select name="stationId">
				<option value=""></option>
				{#each data.stations as s (s.id)}<option value={s.id}>{s.networkName} — {s.name}</option
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
		<button>{m.admin_save()}</button>
	</form>
</section>

<section aria-label={m.admin_stations()}>
	<h3>{m.admin_stations()}</h3>
	<table data-testid="admin-stations">
		<tbody>
			{#each data.stations as s (s.id)}
				<tr class:inactive={!s.isActive}>
					<td>{s.networkName}</td>
					<td>{s.name}</td>
					<td>
						<form method="POST" action="?/stationActive">
							<input type="hidden" name="stationId" value={s.id} />
							<input type="hidden" name="isActive" value={String(!s.isActive)} />
							<button>{s.isActive ? m.admin_deactivate() : m.admin_activate()}</button>
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
		border-collapse: collapse;
		margin-bottom: 1.5rem;
	}
	td {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--border, #e2e2e2);
		vertical-align: top;
	}
	.bad {
		color: #c62828;
		font-weight: 600;
	}
	.stale {
		color: #b26a00;
	}
	.msg {
		font-size: 0.8rem;
		opacity: 0.7;
		max-width: 24rem;
	}
	.inactive {
		opacity: 0.45;
	}
	.grid {
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
	.ok {
		color: var(--accent, #2e7d32);
	}
	.err {
		color: #c62828;
	}
</style>
