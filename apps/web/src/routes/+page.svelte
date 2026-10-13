<script lang="ts">
	import { formatBytes, formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1>Demos</h1>

{#if data.demos.length === 0}
	<p class="empty">No demos yet.</p>
{:else}
	<div class="table">
		<table>
			<thead>
				<tr>
					<th>File</th>
					<th>Size</th>
					<th>Source</th>
					<th>Status</th>
					<th>Added</th>
				</tr>
			</thead>
			<tbody>
				{#each data.demos as demo (demo.id)}
					<tr>
						<td class="file">{demo.fileName}</td>
						<td>{formatBytes(demo.fileSize)}</td>
						<td>{demo.source}</td>
						<td>
							<span class="status {demo.status}" title={demo.error ?? undefined}>{demo.status}</span
							>
						</td>
						<td>{formatDate(demo.createdAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	h1 {
		margin: 0 0 20px;
		font-size: 22px;
		font-weight: 650;
	}

	.empty {
		padding: 48px;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		color: var(--muted);
		text-align: center;
	}

	.table {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 10px 14px;
		text-align: left;
		white-space: nowrap;
	}

	th {
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		background: var(--surface-2);
	}

	tbody tr + tr td {
		border-top: 1px solid var(--border);
	}

	.file {
		max-width: 360px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		background: var(--surface-2);
		color: var(--muted);
	}

	.status.processing {
		color: var(--warn);
	}

	.status.ready {
		color: var(--ok);
	}

	.status.failed {
		color: var(--danger);
	}
</style>
