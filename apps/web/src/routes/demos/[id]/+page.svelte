<script lang="ts">
	import { mapTitle, type TeamKey } from '@cs-demo-cloud/replay';
	import { formatDate, formatDuration, platformName } from '#lib/format.ts';
	import Viewer from '#lib/viewer/Viewer.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let confirmDelete = $state(false);

	const details = $derived(data.details);
	const teamKeys: TeamKey[] = ['a', 'b'];

	const teamNames = $derived.by((): Record<TeamKey, string> => {
		const clean = (name: string | null) => name?.replace(/^team_/, '') || null;
		return {
			a: clean(details?.match.teamAName ?? null) ?? 'Team A',
			b: clean(details?.match.teamBName ?? null) ?? 'Team B'
		};
	});

	const startSide = (team: TeamKey) => {
		const first = details?.match.teamAStartSide ?? 'CT';
		return team === 'a' ? first : first === 'CT' ? 'T' : 'CT';
	};

	const percent = (part: number, total: number) =>
		total > 0 ? Math.round((part / total) * 100) : 0;
</script>

<svelte:head>
	<title
		>{details
			? `${mapTitle(details.match.map)} ${details.match.scoreA}:${details.match.scoreB}`
			: data.demo.fileName} · cs-demo-cloud</title
	>
</svelte:head>

{#if !details}
	<p class="pending">
		{data.demo.fileName} is {data.demo.status === 'failed' ? 'not parsed' : 'still being parsed'}.
		{#if data.demo.error}<br /><span class="error">{data.demo.error}</span>{/if}
	</p>
	<a href="/">Back to matches</a>
	<div class="actions">
		{#if data.demo.status !== 'processing'}
			<form method="POST" action="?/reparse">
				<button type="submit">Parse again</button>
			</form>
		{/if}
		{@render deleteForm()}
	</div>
{:else}
	{@const { match, players, rounds } = details}
	{#if data.demo.status !== 'ready'}
		<p class="stale" class:failed={data.demo.status === 'failed'}>
			{#if data.demo.status === 'failed'}
				Parsing again failed: {data.demo.error ?? 'unknown error'}. Showing the previous parse.
			{:else}
				Being parsed again; this shows the previous parse until it's done.
			{/if}
		</p>
	{/if}
	<header class="match">
		<div>
			<h1>{mapTitle(match.map)}</h1>
			<p class="meta">
				{platformName(match.platform)} · {formatDate(
					data.demo.fileModifiedAt ?? data.demo.createdAt
				)} ·
				{formatDuration(match.durationSeconds)} · {match.roundCount} rounds
			</p>
		</div>
		<div class="final">
			<span class="name">{teamNames.a}</span>
			<span class="score" class:win={match.scoreA > match.scoreB}>{match.scoreA}</span>
			<span class="colon">:</span>
			<span class="score" class:win={match.scoreB > match.scoreA}>{match.scoreB}</span>
			<span class="name">{teamNames.b}</span>
		</div>
	</header>

	<Viewer
		demoId={data.demo.id}
		version={match.parsedAt.getTime()}
		map={match.map}
		mapPack={data.mapPack}
		playerPack={data.playerPack}
		skinsPack={data.skinsPack}
		agentsPack={data.agentsPack}
		soundsPack={data.soundsPack}
		{rounds}
		{teamNames}
		config={data.config}
	/>

	<section class="scoreboard">
		{#each teamKeys as team (team)}
			<div class="table">
				<table>
					<thead>
						<tr>
							<th class="player">
								{teamNames[team]}
								<span class="started">started {startSide(team)}</span>
							</th>
							<th>K</th>
							<th>D</th>
							<th>A</th>
							<th>+/−</th>
							<th>ADR</th>
							<th>HS%</th>
							<th>MVP</th>
							<th>Score</th>
						</tr>
					</thead>
					<tbody>
						{#each players.filter((p) => p.team === team) as player (player.steamid)}
							{@const diff = player.kills - player.deaths}
							<tr>
								<td class="player">
									{#if /^\d{17}$/.test(player.steamid)}
										<a
											href="https://steamcommunity.com/profiles/{player.steamid}"
											target="_blank"
											rel="noopener noreferrer">{player.name}</a
										>
									{:else}
										{player.name}
									{/if}
								</td>
								<td>{player.kills}</td>
								<td>{player.deaths}</td>
								<td>{player.assists}</td>
								<td class:pos={diff > 0} class:neg={diff < 0}>{diff > 0 ? `+${diff}` : diff}</td>
								<td>{Math.round(player.damage / Math.max(1, match.roundCount))}</td>
								<td>{percent(player.headshotKills, player.kills)}%</td>
								<td>{player.mvps}</td>
								<td>{player.score}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/each}
	</section>

	<footer class="actions">
		<span class="file">
			{data.demo.fileName}{details.uploader ? ` · uploaded by ${details.uploader}` : ''}
		</span>
		<form method="POST" action="?/reparse">
			<button type="submit">Parse again</button>
		</form>
		{@render deleteForm()}
	</footer>
{/if}

{#snippet deleteForm()}
	{#if data.canDelete}
		{#if confirmDelete}
			<form method="POST" action="?/delete" class="confirm">
				<span>Delete this demo and its replay for good?</span>
				<button type="submit" class="danger">Delete</button>
				<button type="button" onclick={() => (confirmDelete = false)}>Keep</button>
			</form>
		{:else}
			<button type="button" class="danger" onclick={() => (confirmDelete = true)}
				>Delete demo</button
			>
		{/if}
		{#if form?.message}<p class="error">{form.message}</p>{/if}
	{/if}
{/snippet}

<style>
	.stale {
		margin: 0 0 14px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--surface);
		color: var(--muted);
		font-size: 13.5px;
	}

	.stale.failed {
		color: var(--danger);
	}

	.match {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px 24px;
		margin-bottom: 18px;
	}

	h1 {
		margin: 0;
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.meta {
		margin: 4px 0 0;
		color: var(--muted);
		font-size: 13.5px;
	}

	.final {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-variant-numeric: tabular-nums;
	}

	.final .name {
		color: var(--muted);
		font-weight: 600;
	}

	.final .score {
		font-size: 30px;
		font-weight: 750;
		color: var(--muted);
	}

	.final .score.win {
		color: var(--text);
	}

	.colon {
		color: var(--muted);
		font-size: 22px;
	}

	.scoreboard {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr));
		gap: 16px;
		margin-top: 28px;
	}

	.table {
		overflow-x: auto;
		border-radius: var(--radius);
		background: var(--surface);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		font-size: 14px;
	}

	th,
	td {
		padding: 8px 10px;
		text-align: right;
		white-space: nowrap;
	}

	th {
		background: var(--surface-2);
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
	}

	.player {
		text-align: left;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	th.player {
		color: var(--text);
		font-size: 13px;
	}

	.started {
		margin-left: 6px;
		color: var(--muted);
		font-weight: 500;
	}

	tbody tr + tr td {
		border-top: 1px solid var(--border);
	}

	td a {
		text-decoration: none;
	}

	td a:hover {
		text-decoration: underline;
	}

	.pos {
		color: var(--ok);
	}

	.neg {
		color: var(--danger);
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 24px;
		color: var(--muted);
		font-size: 13px;
	}

	.actions button {
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}

	.actions .file {
		flex: 1;
	}

	.actions button.danger {
		color: var(--danger);
	}

	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.pending {
		padding: 32px;
		border-radius: var(--radius);
		background: var(--surface);
	}

	.error {
		color: var(--danger);
	}
</style>
