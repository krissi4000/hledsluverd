<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate, formatTime } from '$lib/format';
	import SeoHead from '$lib/components/SeoHead.svelte';
	import { OG_FALLBACK_PATH } from '$lib/seo';

	let { children, data } = $props();
	const other = () => (getLocale() === 'is' ? 'en' : 'is');

	// Defaults for every route; a route's load overrides them by returning `seo`.
	const seo = $derived.by(() => {
		const s = page.data.seo ?? {};
		const fallbackTitle = `${m.site_title()} — ${m.site_tagline()}`;
		return {
			title: s.title ?? fallbackTitle,
			description: s.description ?? m.seo_default_description(),
			image: s.image ?? { path: OG_FALLBACK_PATH, alt: fallbackTitle },
			noindex: s.noindex ?? page.error !== null
		};
	});

	// "Um vefinn" lives in the footer: the header keeps to what visitors come for
	const links = [
		{ href: '/kort', label: () => m.nav_map() },
		{ href: '/verdthroun', label: () => m.nav_trends() }
	];

	const isCurrent = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#15803d" />
</svelte:head>
<SeoHead {seo} origin={data.siteOrigin} path={page.data.seo?.path ?? page.url.pathname} />

<header class="site-header">
	<div class="bar">
		<a class="brand" href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>
			<span class="mark" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="17" height="17"
					><path fill="currentColor" d="M13.2 2 4.6 13.4h6.1L9.8 22l8.6-11.4h-6.1L13.2 2Z" /></svg
				>
			</span>
			<span class="name">{m.site_title()}</span>
		</a>

		<nav class="nav">
			{#each links as l (l.href)}
				<a
					href={l.href}
					class:active={isCurrent(l.href)}
					aria-current={isCurrent(l.href) ? 'page' : undefined}>{l.label()}</a
				>
			{/each}
		</nav>

		<a
			class="lang"
			data-testid="lang-toggle"
			href="/lang?to={other()}&redirect={encodeURIComponent(page.url.pathname + page.url.search)}"
			hreflang={other()}
			lang={other()}
			title={m.lang_switch()}
			aria-label={m.lang_switch()}>{m.lang_switch_short()}</a
		>
	</div>
</header>

<main>
	{@render children()}
</main>

<footer class="site-footer">
	<div class="foot">
		<p class="foot-links">
			<a href="/um">{m.footer_about()}</a>
			<a href="/um#samband">{m.footer_contact()}</a>
			<a href="/um#heimildir">{m.footer_sources()}</a>
		</p>
		<p>
			{m.footer_independent()}{#if data.lastPriceFetch}{' '}<span data-testid="last-price-fetch"
					>{m.footer_last_fetch({
						date: formatDate(data.lastPriceFetch),
						time: formatTime(data.lastPriceFetch)
					})}</span
				>{/if}
		</p>
		<p class="credits">
			{m.footer_stations_data()}
			<a href="https://openchargemap.org" rel="noopener external">Open Charge Map</a>
			(<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener external license"
				>CC BY 4.0</a
			>), Virta, e1,
			<a href="https://supercharge.info" rel="noopener external">supercharge.info</a>
			· {m.footer_availability_data()} TomTom · {m.footer_map_data()}
			<a href="https://www.openstreetmap.org/copyright" rel="noopener external">© OpenStreetMap</a>
		</p>
	</div>
</footer>

<style>
	.site-header {
		position: sticky;
		top: 0;
		z-index: 50;
		background: rgb(255 255 255 / 94%);
		backdrop-filter: saturate(180%) blur(10px);
		border-bottom: 1px solid var(--border);
	}
	.bar {
		max-width: var(--page-max);
		height: var(--header-h);
		margin: 0 auto;
		padding: 0 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		margin-right: auto;
		color: inherit;
		text-decoration: none;
	}
	.mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 9px;
		background: linear-gradient(145deg, #22a355, var(--accent));
		color: #fff;
	}
	.name {
		font-size: 1.05rem;
		font-weight: 750;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}

	.nav {
		display: flex;
		gap: 0.25rem;
	}
	.nav a,
	.lang {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h-sm);
		padding: 0 0.6rem;
		border-radius: var(--radius-sm);
		color: var(--muted);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.nav a:hover,
	.lang:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.nav a.active {
		color: var(--accent-text);
		background: var(--accent-soft);
	}
	.lang {
		margin-left: 0.25rem;
		border: 1px solid var(--border);
		min-width: 2.5rem;
		justify-content: center;
		font-size: 0.8rem;
		letter-spacing: 0.04em;
	}

	main {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
	}

	.site-footer {
		border-top: 1px solid var(--border);
		background: var(--surface);
		color: var(--muted);
		font-size: 0.8rem;
	}
	.foot {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: 1.25rem 1rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.foot p {
		margin: 0;
		line-height: 1.5;
	}
	.foot a {
		color: inherit;
	}
	.foot-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin-bottom: 0.25rem !important;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.foot-links a {
		color: var(--text);
		text-decoration: none;
	}
	.foot-links a:hover {
		text-decoration: underline;
	}
	/* small phones: the wordmark gives way before the nav does */
	@media (max-width: 359px) {
		.name {
			font-size: 0.95rem;
		}
		.nav a {
			padding: 0 0.45rem;
		}
	}
</style>
