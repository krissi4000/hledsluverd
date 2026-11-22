<script lang="ts">
	// The other kind of charging a station also offers, under the price of the kind listed:
	// "Hæg hleðsla: 48 kr/kWh" under a fast price, "Hraðhleðsla: 69 kr/kWh" under a slow
	// one. Lists show one kind at a time (their prices aren't comparable); this says what
	// the other costs there too. Only known prices get here (otherModePrice).
	import * as m from '$lib/paraglide/messages';
	// each part stays whole when a narrow column wraps it: "Hæg hleðsla:" / "48 kr/kWh"
	import { formatIskPerKwh, isStale, noBreak } from '$lib/format';
	import { verifiedText } from '$lib/age';
	import { minuteFeeText } from '$lib/fees';
	import type { OtherModePrice } from '$lib/server/db/queries';

	let { other }: { other: OtherModePrice } = $props();

	// unverified for 30+ days: amber like every other price, the date on hover
	const stale = $derived(isStale(other.verifiedAt));
	const fee = $derived(minuteFeeText(other.minuteFeeIsk, other.minuteFeeAfterMin));
</script>

<small
	class="other"
	class:stale
	title={stale ? verifiedText(other.verifiedAt) : undefined}
	data-testid="other-price"
	>{m.other_mode_price({
		mode: noBreak(other.mode === 'AC' ? m.mode_ac_short() : m.mode_dc_short()),
		price: noBreak(formatIskPerKwh(other.price))
	})}{#if fee}{' '}{fee}{/if}</small
>

<style>
	.other {
		display: block;
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.3;
	}
	.other.stale {
		color: var(--stale);
		font-weight: 600;
	}
</style>
