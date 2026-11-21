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

	type Reason = (typeof data.duplicates)[number]['reasons'][number];
	const reasonText = (r: Reason) =>
		r.kind === 'shared-id'
			? m.admin_reason_shared_id({ key: r.key })
			: r.kind === 'same-name'
				? m.admin_reason_same_name()
				: r.kind === 'similar-name'
					? m.admin_reason_similar_name()
					: m.admin_reason_same_spot();
	const ucValue = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
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

<section aria-label={m.admin_duplicates()}>
	<h3>{m.admin_duplicates()}</h3>
	<p class="help">{m.admin_duplicates_help()}</p>
	{#if data.duplicates.length === 0}
		<p class="muted">{m.admin_duplicates_none()}</p>
	{:else}
		<table class="surface" data-testid="admin-duplicates">
			<tbody>
				{#each data.duplicates as d (`${d.a.id}:${d.b.id}`)}
					<tr>
						<td>{d.a.networkName}</td>
						<td>
							<a href="/stod/{d.a.slug}">{d.a.name}</a> <span class="muted">#{d.a.id}</span><br />
							<a href="/stod/{d.b.slug}">{d.b.name}</a> <span class="muted">#{d.b.id}</span>
						</td>
						<td class="msg">{d.distanceM} m · {d.reasons.map(reasonText).join(', ')}</td>
						<td>
							<div class="dup-actions">
								<form method="POST" action="?/merge">
									<input type="hidden" name="survivorId" value={d.a.id} />
									<input type="hidden" name="mergedId" value={d.b.id} />
									<button class="btn btn-sm">{m.admin_keep({ id: d.a.id })}</button>
								</form>
								<form method="POST" action="?/merge">
									<input type="hidden" name="survivorId" value={d.b.id} />
									<input type="hidden" name="mergedId" value={d.a.id} />
									<button class="btn btn-sm">{m.admin_keep({ id: d.b.id })}</button>
								</form>
								<form method="POST" action="?/dismiss">
									<input type="hidden" name="a" value={d.a.id} />
									<input type="hidden" name="b" value={d.b.id} />
									<button class="btn btn-sm">{m.admin_not_duplicate()}</button>
								</form>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

{#if data.conflicts.length > 0}
	<section aria-label={m.admin_conflicts()}>
		<h3>{m.admin_conflicts()}</h3>
		<p class="help">{m.admin_conflicts_help()}</p>
		<table class="surface" data-testid="admin-conflicts">
			<tbody>
				{#each data.conflicts as c, i (i)}
					<tr>
						<td>{c.station.networkName}</td>
						<td><a href="/stod/{c.station.slug}">{c.station.name}</a></td>
						<td class="msg">
							{#if c.kind === 'name'}
								{m.admin_conflict_name({ brands: c.brands.join(', ') })}
							{:else}
								{m.admin_conflict_colocated({
									m: c.distanceM,
									other: c.other.name,
									network: c.other.networkName
								})}
							{/if}
						</td>
						<td
							><a class="btn btn-sm" href="?leidretta={c.station.id}#leidretta">{m.admin_edit()}</a
							></td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

{#if data.sharedTomtom.length > 0}
	<section aria-label={m.admin_tomtom()}>
		<h3>{m.admin_tomtom()}</h3>
		<p class="help">{m.admin_tomtom_help()}</p>
		<table class="surface" data-testid="admin-tomtom">
			<tbody>
				{#each data.sharedTomtom as t (t.tomtomId)}
					<tr>
						<td class="msg">{t.tomtomId}</td>
						<td>
							{#each t.stations as s, i (s.id)}
								{#if i > 0}<br />{/if}
								<a href="/stod/{s.slug}">{s.name}</a> <span class="muted">({s.networkName})</span>
							{/each}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

{#if data.underConstruction.length > 0}
	<section aria-label={m.under_construction()}>
		<h3>{m.under_construction()}</h3>
		<p class="help">{m.admin_uc_help()}</p>
		<table class="surface" data-testid="admin-under-construction">
			<tbody>
				{#each data.underConstruction as s (s.id)}
					<tr>
						<td>{s.networkName}</td>
						<td><a href="/stod/{s.slug}">{s.name}</a></td>
						<td class="msg">{s.byHand ? m.admin_uc_flagged() : m.admin_uc_detected()}</td>
						<td><a class="btn btn-sm" href="?leidretta={s.id}#leidretta">{m.admin_edit()}</a></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<section aria-label={m.admin_override()} id="leidretta">
	<h3>{m.admin_override()}</h3>
	<p class="help">{m.admin_override_help()}</p>
	<form method="GET" class="pick">
		<select name="leidretta" aria-label={m.th_station()}>
			<option value=""></option>
			{#each data.stations as s (s.id)}
				<option value={s.id} selected={data.edit?.id === s.id}>{s.networkName} — {s.name}</option>
			{/each}
		</select>
		<button class="btn btn-sm">{m.admin_edit()}</button>
	</form>
	{#if data.edit}
		{@const e = data.edit}
		<form method="POST" action="?/override" class="grid surface" data-testid="admin-override-form">
			<input type="hidden" name="stationId" value={e.id} />
			<p class="current">
				<a href="/stod/{e.slug}">{e.name}</a> · {e.networkName} · {e.connectors || '—'}
			</p>
			<label>
				{m.admin_override_name()}
				<input name="name" value={e.override?.name ?? ''} placeholder={e.name} />
			</label>
			<label>
				{m.th_network()}
				<select name="networkId">
					<option value="">{m.admin_override_unchanged()}</option>
					{#each data.networks as n (n.id)}
						<option value={n.id} selected={e.override?.networkId === n.id}>{n.name}</option>
					{/each}
				</select>
			</label>
			<label>
				{m.admin_override_connectors()}
				<input name="connectors" value={e.override?.connectors ?? ''} placeholder={e.connectors} />
			</label>
			<label>
				{m.under_construction()}
				<select name="underConstruction">
					<option value="" selected={ucValue(e.underConstruction) === ''}
						>{m.admin_uc_auto()}</option
					>
					<option value="yes" selected={ucValue(e.underConstruction) === 'yes'}
						>{m.admin_yes()}</option
					>
					<option value="no" selected={ucValue(e.underConstruction) === 'no'}>{m.admin_no()}</option
					>
				</select>
			</label>
			<label>
				{m.admin_override_note()}
				<input name="note" value={e.override?.note ?? ''} />
			</label>
			<button class="btn btn-primary">{m.admin_save()}</button>
		</form>
	{/if}

	{#if data.overrides.length > 0}
		<h4>{m.admin_overrides()}</h4>
		<table class="surface" data-testid="admin-overrides">
			<tbody>
				{#each data.overrides as o (o.station?.id)}
					{#if o.station}
						<tr>
							<td><a href="/stod/{o.station.slug}">{o.station.name}</a></td>
							<td class="msg">
								{[o.name, o.networkName, o.connectors].filter(Boolean).join(' · ')}
								{#if o.note}<br /><em>{o.note}</em>{/if}
							</td>
							<td>
								<a class="btn btn-sm" href="?leidretta={o.station.id}#leidretta">{m.admin_edit()}</a
								>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	{/if}
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
						{formatNumber(p.priceIskPerKwh)} kr/kWh{#if p.minuteFeeIsk}
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
					<td>
						{s.name}
						{#if s.mergedInto}
							<span class="muted">· {m.admin_merged_into({ name: s.mergedInto })}</span>
						{/if}
					</td>
					<td><a class="btn btn-sm" href="?leidretta={s.id}#leidretta">{m.admin_edit()}</a></td>
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
	.help {
		margin: -0.25rem 0 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
		max-width: 48rem;
	}
	.dup-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.pick {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.current {
		grid-column: 1 / -1;
		margin: 0;
		font-size: 0.9rem;
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
		margin-bottom: 1.5rem;
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
