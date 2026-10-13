<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>Sign in · cs-demo-cloud</title>
</svelte:head>

<form class="card" method="POST">
	<h1>Sign in</h1>
	<label>
		Name
		<input name="name" autocomplete="username" required value={form?.name ?? ''} />
	</label>
	<label>
		Password
		<input name="password" type="password" autocomplete="current-password" required />
	</label>
	{#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
	<button type="submit" class="primary">Sign in</button>
	<p class="hint">New here? Ask for an invite link.</p>
</form>
