<script lang="ts">
	import { formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Create your account · cs-demo-cloud</title>
</svelte:head>

{#if !data.valid}
	<div class="card">
		<h1>Invite not valid</h1>
		<p>This invite link is invalid, expired or already used. Ask for a new one.</p>
		<a class="button" href="/login">Go to sign in</a>
	</div>
{:else}
	<form class="card" method="POST">
		<h1>Create your account</h1>
		<p class="hint">
			{data.role === 'admin' ? 'Admin account' : 'Account'} · invite valid until {formatDate(
				data.expiresAt!
			)}
		</p>
		{#if data.signedInAs}
			<p class="hint">
				You’re signed in as {data.signedInAs}. Creating an account here signs you in as the new one.
			</p>
		{/if}
		<label>
			Name
			<input
				name="name"
				autocomplete="username"
				required
				minlength="2"
				maxlength="32"
				value={form?.name ?? ''}
			/>
		</label>
		<label>
			Password
			<input name="password" type="password" autocomplete="new-password" required minlength="10" />
		</label>
		<label>
			Repeat password
			<input name="confirm" type="password" autocomplete="new-password" required minlength="10" />
		</label>
		{#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
		<button type="submit" class="primary">Create account</button>
	</form>
{/if}
