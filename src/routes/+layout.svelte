<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { children } = $props();
	const other = () => (getLocale() === 'is' ? 'en' : 'is');
</script>

<header>
	<a href="/" class="logo">{m.site_title()}</a>
	<p class="tagline">{m.site_tagline()}</p>
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
		text-decoration: none;
		color: inherit;
	}
	.tagline {
		margin: 0;
		opacity: 0.7;
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
