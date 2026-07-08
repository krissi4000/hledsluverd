<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { children } = $props();
	const other = () => (getLocale() === 'is' ? 'en' : 'is');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header>
	<h1 class="logo"><a href="/">{m.site_title()}</a></h1>
	<p class="tagline">{m.site_tagline()}</p>
	<nav class="nav">
		<a href="/kort">{m.nav_map()}</a>
		<a href="/verdthroun">{m.nav_trends()}</a>
	</nav>
	<a
		class="lang"
		data-testid="lang-toggle"
		href="/lang?to={other()}&redirect={encodeURIComponent(page.url.pathname + page.url.search)}"
	>
		{m.lang_switch()}
	</a>
</header>

<main>
	{@render children()}
</main>

<style>
	:global(body) {
		font-family: system-ui, sans-serif;
		margin: 0;
		color: #1b1b1b;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e2e2e2;
	}
	.logo {
		font-size: 1.3rem;
		font-weight: 700;
		margin: 0;
	}
	.logo a {
		text-decoration: none;
		color: inherit;
	}
	.tagline {
		margin: 0;
		opacity: 0.7;
		font-size: 0.9rem;
	}
	.nav {
		display: inline-flex;
		gap: 0.75rem;
		font-size: 0.9rem;
	}
	.lang {
		margin-left: auto;
		font-size: 0.9rem;
	}
	main {
		max-width: 68rem;
		margin: 0 auto;
		padding: 1rem;
	}
</style>
