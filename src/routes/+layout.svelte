<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { children } = $props();
	const other = () => (getLocale() === 'is' ? 'en' : 'is');

	const links = [
		{ href: '/kort', label: () => m.nav_map() },
		{ href: '/bilaleit', label: () => m.nav_finder() },
		{ href: '/verdthroun', label: () => m.nav_trends() }
	];

	const isCurrent = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#15803d" />
</svelte:head>

<header class="site-header">
	<div class="bar">
		<a class="brand" href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>
			<span class="mark" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="18" height="18"
					><path fill="currentColor" d="M13.2 2 4.6 13.4h6.1L9.8 22l8.6-11.4h-6.1L13.2 2Z" /></svg
				>
			</span>
			<span class="brand-text">
				<h1 class="logo">{m.site_title()}</h1>
				<span class="tagline">{m.site_tagline()}</span>
			</span>
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
		>
			<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
				><path
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z"
				/></svg
			>
			{m.lang_switch()}
		</a>
	</div>
</header>

<main>
	{@render children()}
</main>

<style>
	.site-header {
		position: sticky;
		top: 0;
		z-index: 50;
		background: rgb(255 255 255 / 92%);
		backdrop-filter: saturate(180%) blur(10px);
		border-bottom: 1px solid var(--border);
	}
	.bar {
		max-width: 72rem;
		height: var(--header-h);
		margin: 0 auto;
		padding: 0 1rem;
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}
	.mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 10px;
		background: linear-gradient(145deg, #22a355, var(--accent));
		color: #fff;
		box-shadow: 0 2px 6px rgb(21 128 61 / 30%);
	}
	.brand-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.15;
	}
	.logo {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 750;
		letter-spacing: -0.02em;
	}
	.tagline {
		font-size: 0.75rem;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nav {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 999px;
		background: var(--surface-2);
	}
	.nav a {
		padding: 0.4rem 0.95rem;
		border-radius: 999px;
		color: var(--muted);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
		transition:
			background-color 0.15s,
			color 0.15s;
	}
	.nav a:hover {
		color: var(--text);
	}
	.nav a.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}

	.lang {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		color: var(--muted);
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
	}
	.lang:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
	}

	@media (max-width: 860px) {
		.tagline {
			display: none;
		}
	}

	/* phone: brand + language on top, full-width nav underneath */
	@media (max-width: 640px) {
		.bar {
			flex-wrap: wrap;
			align-content: center;
			gap: 0.5rem 0.75rem;
		}
		.nav {
			order: 3;
			flex: 1 0 100%;
		}
		.nav a {
			flex: 1;
			text-align: center;
			padding: 0.4rem 0.5rem;
		}
		main {
			padding-top: 1rem;
		}
	}
</style>
