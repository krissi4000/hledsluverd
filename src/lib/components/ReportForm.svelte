<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	/** COMMENT_MAX / EMAIL_MAX in $lib/server/reports — the server enforces them too */
	const COMMENT_MAX = 1000;
	const EMAIL_MAX = 254;

	let {
		result
	}: {
		/** the report action's result: reported, or why it was refused */
		result: { reported?: boolean; reportError?: string } | null | undefined;
	} = $props();

	let sending = $state(false);
	const kinds = [
		{ value: 'price', label: () => m.report_kind_price() },
		{ value: 'closed', label: () => m.report_kind_closed() },
		{ value: 'availability', label: () => m.report_kind_availability() },
		{ value: 'other', label: () => m.report_kind_other() }
	];
</script>

<section class="report" id="tilkynna" aria-labelledby="report-title">
	{#if result?.reported}
		<p class="thanks" role="status" data-testid="report-thanks">{m.report_thanks()}</p>
	{:else}
		<!-- a <details> keeps the page calm and needs no JS; it opens again after an error -->
		<details open={!!result?.reportError}>
			<summary class="btn btn-ghost btn-sm"
				><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
					><path
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M5 21V4m0 0h11l-2 4 2 4H5"
					/></svg
				><span id="report-title">{m.report_title()}</span></summary
			>
			<div class="box surface">
				<p class="intro">{m.report_intro()}</p>
				{#if result?.reportError}
					<p class="err" role="alert">
						{result.reportError === 'rate_limited'
							? m.report_error_rate()
							: m.report_error_invalid()}
					</p>
				{/if}
				<form
					method="POST"
					action="?/report"
					data-testid="report-form"
					use:enhance={() => {
						sending = true;
						return async ({ update }) => {
							await update();
							sending = false;
						};
					}}
				>
					<fieldset>
						<legend>{m.report_kind()}</legend>
						{#each kinds as k, i (k.value)}
							<label class="radio"
								><input type="radio" name="kind" value={k.value} required checked={i === 0} />
								{k.label()}</label
							>
						{/each}
					</fieldset>
					<label
						>{m.report_price()}
						<input name="correctPrice" inputmode="decimal" maxlength="6" autocomplete="off" />
					</label>
					<label
						>{m.report_comment()}
						<textarea name="comment" rows="3" maxlength={COMMENT_MAX}></textarea>
					</label>
					<label
						>{m.report_email()}
						<input name="email" type="email" maxlength={EMAIL_MAX} autocomplete="email" />
					</label>
					<!-- honeypot: hidden from people and screen readers, irresistible to bots -->
					<div class="hp" aria-hidden="true">
						<label
							>{m.report_honeypot()}
							<input name="website" tabindex="-1" autocomplete="off" />
						</label>
					</div>
					<button class="btn btn-primary" disabled={sending}>{m.report_submit()}</button>
				</form>
			</div>
		</details>
	{/if}
</section>

<style>
	.report {
		margin-top: 1rem;
	}
	summary {
		margin-left: -0.6rem;
	}
	details[open] summary {
		color: var(--text);
	}
	.box {
		margin-top: 0.4rem;
		padding: 1rem 1.1rem;
	}
	.intro {
		margin: 0 0 0.75rem;
		color: var(--muted);
		font-size: 0.9rem;
	}
	form {
		display: grid;
		gap: 0.75rem;
		max-width: 32rem;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
	}
	legend {
		margin-bottom: 0.35rem;
		font-size: 0.9rem;
		font-weight: 600;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	label.radio {
		flex-direction: row;
		align-items: center;
		gap: 0.35rem;
	}
	button {
		justify-self: start;
	}
	.hp {
		position: absolute;
		left: -10000px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	.thanks,
	.err {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}
	.thanks {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.err {
		margin-bottom: 0.75rem;
		background: #fdecec;
		color: var(--danger);
	}
</style>
