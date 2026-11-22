<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { OG_IMAGE_SIZE, absoluteUrl, ogLocale, type SeoMeta } from '$lib/seo';

	let {
		seo,
		origin,
		path
	}: {
		seo: Required<Pick<SeoMeta, 'title' | 'description' | 'image'>> & SeoMeta;
		/** absolute site origin, no trailing slash */
		origin: string;
		/** canonical path */
		path: string;
	} = $props();

	const url = $derived(absoluteUrl(origin, path));
</script>

<svelte:head>
	<title>{seo.title}</title>
	<meta name="description" content={seo.description} />
	{#if seo.noindex}
		<meta name="robots" content="noindex" />
	{:else}
		<link rel="canonical" href={url} />
	{/if}

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={m.site_title()} />
	<meta property="og:locale" content={ogLocale(getLocale())} />
	<meta property="og:url" content={url} />
	<meta property="og:title" content={seo.title} />
	<meta property="og:description" content={seo.description} />
	<meta property="og:image" content={absoluteUrl(origin, seo.image.path)} />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:image:width" content={String(OG_IMAGE_SIZE.width)} />
	<meta property="og:image:height" content={String(OG_IMAGE_SIZE.height)} />
	<meta property="og:image:alt" content={seo.image.alt} />

	<!-- X reads title, description and image from the og: tags -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image:alt" content={seo.image.alt} />
</svelte:head>
