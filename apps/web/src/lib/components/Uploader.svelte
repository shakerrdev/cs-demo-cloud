<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatBytes } from '#lib/format.ts';

	type Status = 'waiting' | 'uploading' | 'done' | 'duplicate' | 'failed';
	interface Upload {
		key: number;
		file: File;
		loaded: number;
		status: Status;
		message: string;
	}

	let uploads = $state<Upload[]>([]);
	let dragging = $state(false);
	let running = false;
	let nextKey = 0;
	let input: HTMLInputElement;

	const statusText: Record<Status, string> = {
		waiting: 'Waiting',
		uploading: 'Uploading',
		done: 'Queued for parsing',
		duplicate: 'Already uploaded',
		failed: 'Failed'
	};

	export function add(files: Iterable<File>) {
		for (const file of files) {
			uploads.push({ key: nextKey++, file, loaded: 0, status: 'waiting', message: '' });
		}
		if (!running) run();
	}

	async function run() {
		running = true;
		let upload: Upload | undefined;
		while ((upload = uploads.find((u) => u.status === 'waiting'))) {
			await send(upload);
			await invalidateAll();
		}
		running = false;
	}

	function send(upload: Upload): Promise<void> {
		return new Promise((resolve) => {
			const request = new XMLHttpRequest();
			request.open('POST', '/api/demos');
			request.setRequestHeader('content-type', 'application/octet-stream');
			request.setRequestHeader('x-file-name', encodeURIComponent(upload.file.name));
			request.setRequestHeader('x-file-modified', String(upload.file.lastModified));
			request.upload.onprogress = (event) => (upload.loaded = event.loaded);
			request.onload = () => {
				if (request.status === 201) upload.status = 'done';
				else if (request.status === 200) upload.status = 'duplicate';
				else {
					upload.status = 'failed';
					upload.message = readError(request.responseText) ?? `Server answered ${request.status}`;
				}
				resolve();
			};
			request.onerror = () => {
				upload.status = 'failed';
				upload.message = 'Connection lost';
				resolve();
			};
			upload.status = 'uploading';
			request.send(upload.file);
		});
	}

	function readError(text: string): string | null {
		try {
			return (JSON.parse(text) as { message?: string }).message ?? null;
		} catch {
			return null;
		}
	}

	function clearFinished() {
		uploads = uploads.filter((u) => u.status === 'waiting' || u.status === 'uploading');
	}

	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
</script>

<svelte:window
	ondragenter={(event) => {
		if (hasFiles(event)) dragging = true;
	}}
	ondragover={(event) => {
		if (hasFiles(event)) event.preventDefault();
	}}
	ondragleave={(event) => {
		if (!event.relatedTarget) dragging = false;
	}}
	ondrop={(event) => {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragging = false;
		add(event.dataTransfer!.files);
	}}
/>

<section class="dropzone" class:dragging>
	<input
		bind:this={input}
		type="file"
		multiple
		accept=".dem,.bz2,.gz,.zst"
		hidden
		onchange={() => {
			if (input.files) add(input.files);
			input.value = '';
		}}
	/>
	<div class="prompt">
		<strong>Drop demos anywhere</strong>
		<span>.dem, .dem.bz2, .dem.gz or .dem.zst</span>
	</div>
	<button type="button" onclick={() => input.click()}>Choose files</button>
</section>

{#if uploads.length}
	<ul class="uploads">
		{#each uploads as upload (upload.key)}
			<li class={upload.status}>
				<span class="name">{upload.file.name}</span>
				<span class="detail">
					{#if upload.status === 'uploading'}
						{formatBytes(upload.loaded)} of {formatBytes(upload.file.size)}
					{:else if upload.status === 'failed'}
						{upload.message}
					{:else}
						{statusText[upload.status]}
					{/if}
				</span>
				<progress
					max={upload.file.size}
					value={upload.status === 'waiting'
						? 0
						: upload.status === 'uploading'
							? upload.loaded
							: upload.file.size}
				></progress>
			</li>
		{/each}
	</ul>
	{#if uploads.some((u) => u.status !== 'waiting' && u.status !== 'uploading')}
		<button type="button" class="link" onclick={clearFinished}>Clear finished</button>
	{/if}
{/if}

{#if dragging}
	<div class="overlay" aria-hidden="true"><span>Drop to upload</span></div>
{/if}

<style>
	.dropzone {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 20px;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.dropzone.dragging {
		border-color: var(--accent);
	}

	.prompt {
		display: grid;
		gap: 2px;
	}

	.prompt span {
		color: var(--muted);
		font-size: 13px;
	}

	button {
		padding: 8px 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	button:hover {
		border-color: var(--accent);
	}

	button.link {
		margin-top: 6px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--muted);
		font-weight: 500;
		font-size: 13px;
	}

	.uploads {
		display: grid;
		gap: 6px;
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
	}

	.uploads li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
		padding: 10px 14px;
		border-radius: 8px;
		background: var(--surface);
		font-size: 14px;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.failed .detail {
		color: var(--danger);
	}

	.done .detail {
		color: var(--ok);
	}

	progress {
		grid-column: 1 / -1;
		width: 100%;
		height: 4px;
		appearance: none;
		border: 0;
		border-radius: 2px;
		background: var(--surface-2);
		overflow: hidden;
	}

	progress::-webkit-progress-bar {
		background: var(--surface-2);
	}

	progress::-webkit-progress-value {
		background: var(--accent);
	}

	progress::-moz-progress-bar {
		background: var(--accent);
	}

	.failed progress::-webkit-progress-value {
		background: var(--danger);
	}

	.overlay {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		background: rgb(14 16 19 / 0.82);
		border: 3px dashed var(--accent);
		pointer-events: none;
	}

	.overlay span {
		font-size: 22px;
		font-weight: 650;
	}
</style>
