<script lang="ts">
	import {
		buyLabels,
		mapTitle,
		roundBuys,
		type BuyType,
		type TeamKey
	} from '@cs-demo-cloud/replay';
	import { formatBytes, formatDate, formatDuration, platformName } from '#lib/format.ts';
	import Heatmap from '#lib/components/Heatmap.svelte';
	import RoundLog from '#lib/components/RoundLog.svelte';
	import Viewer from '#lib/viewer/Viewer.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let confirmDelete = $state(false);
	const details = $derived(data.details);
	let board = $state<'basic' | 'advanced' | 'rounds' | 'economy' | 'positions'>('basic');
	const buys = $derived(
		details ? roundBuys(details.rounds) : new Map<number, Record<TeamKey, BuyType> | null>()
	);
	const hasEconomy = $derived(details?.rounds.some((r) => r.teamAEquipment !== null) ?? false);
	const maxEquipment = $derived(
		Math.max(
			20000,
			...(details?.rounds.flatMap((r) => [r.teamAEquipment ?? 0, r.teamBEquipment ?? 0]) ?? [])
		)
	);
	const money = (value: number | null) =>
		value === null ? '–' : `$${value.toLocaleString('en-US')}`;
	const statsOf = $derived(new Map(data.stats?.players.map((p) => [p.steamid, p]) ?? []));
	const openingsWon = (team: TeamKey) =>
		data.stats?.openings.filter((o) => o.team === team).length ?? 0;

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
		{@render downloads()}
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

	<div class="board-switch" role="tablist" aria-label="Scoreboard">
		<button
			type="button"
			role="tab"
			aria-selected={board === 'basic'}
			onclick={() => (board = 'basic')}>Scoreboard</button
		>
		<button
			type="button"
			role="tab"
			aria-selected={board === 'advanced'}
			onclick={() => (board = 'advanced')}>Duels &amp; clutches</button
		>
		<button
			type="button"
			role="tab"
			aria-selected={board === 'rounds'}
			onclick={() => (board = 'rounds')}>Rounds</button
		>
		<button
			type="button"
			role="tab"
			aria-selected={board === 'economy'}
			onclick={() => (board = 'economy')}>Economy</button
		>
		<button
			type="button"
			role="tab"
			aria-selected={board === 'positions'}
			onclick={() => (board = 'positions')}>Kill positions</button
		>
		{#if board === 'advanced' && data.stats}
			<span class="openings"
				>Opening duels {teamNames.a} {openingsWon('a')} – {openingsWon('b')} {teamNames.b}</span
			>
		{/if}
	</div>

	{#if board === 'rounds'}
		<section class="economy" aria-label="Round log">
			<RoundLog
				rounds={details.rounds}
				kills={data.kills}
				{players}
				{teamNames}
				tickRate={match.tickRate}
			/>
		</section>
	{:else if board === 'positions'}
		<section class="economy" aria-label="Kill positions">
			<Heatmap
				demoId={data.demo.id}
				version={match.parsedAt.getTime()}
				map={match.map}
				roundNumbers={details.rounds.map((r) => r.number)}
				players={players.map((p) => ({ steamid: p.steamid, name: p.name }))}
			/>
		</section>
	{:else if board === 'economy'}
		<section class="economy" aria-label="Economy per round">
			{#if !hasEconomy}
				<p class="hint">
					Economy is recorded while parsing. Use <b>Parse again</b> below to add it to this match.
				</p>
			{:else}
				{#each teamKeys as team (team)}
					<div class="eco-row">
						<span class="eco-team">{teamNames[team]}</span>
						<div class="eco-rounds">
							{#each details.rounds as r (r.number)}
								{@const value = team === 'a' ? r.teamAEquipment : r.teamBEquipment}
								{@const cash = team === 'a' ? r.teamAMoney : r.teamBMoney}
								{@const buy = buys.get(r.number)?.[team]}
								<a
									href="#round-{r.number}"
									class="eco-cell"
									class:won={r.winnerTeam === team}
									class:flip={team === 'b'}
									title="Round {r.number} · {buy ? buyLabels[buy] : 'No data'} · equipment {money(
										value
									)} · bank {money(cash)}{r.winnerTeam === team ? ' · won' : ''}"
								>
									<span
										class="eco-bar buy-{buy ?? 'none'}"
										style="height: {Math.max(4, ((value ?? 0) / maxEquipment) * 100)}%"
									></span>
								</a>
							{/each}
						</div>
					</div>
					{#if team === 'a'}
						<div class="eco-row numbers">
							<span class="eco-team"></span>
							<div class="eco-rounds">
								{#each details.rounds as r (r.number)}
									<span class="eco-number">{r.number}</span>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
				<p class="legend">
					{#each Object.entries(buyLabels) as [key, label] (key)}
						<span><i class="eco-bar buy-{key}"></i>{label}</span>
					{/each}
					<span class="won-key">Outlined: round won</span>
				</p>
			{/if}
		</section>
	{:else}
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
								{#if board === 'basic'}
									<th>K</th>
									<th>D</th>
									<th>A</th>
									<th>+/−</th>
									<th>ADR</th>
									<th>HS%</th>
									<th>MVP</th>
									<th>Score</th>
								{:else}
									<th title="Rounds with a kill, assist, survival or traded death">KAST</th>
									<th title="Opening kills – opening deaths">Open</th>
									<th title="Kills within 5 s of an enemy killing a teammate">Trades</th>
									<th title="Rounds with 2, 3, 4 and 5 kills">2K/3K/4K/5K</th>
									<th title="Clutches won / played (last player alive)">Clutch</th>
									<th title="Kills on enemies this player flashed">Flash A</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each players.filter((p) => p.team === team) as player (player.steamid)}
								{@const diff = player.kills - player.deaths}
								<tr>
									<td class="player">
										<a href="/players/{player.steamid}">{player.name}</a>
									</td>
									{#if board === 'basic'}
										<td>{player.kills}</td>
										<td>{player.deaths}</td>
										<td>{player.assists}</td>
										<td class:pos={diff > 0} class:neg={diff < 0}>{diff > 0 ? `+${diff}` : diff}</td
										>
										<td>{Math.round(player.damage / Math.max(1, match.roundCount))}</td>
										<td>{percent(player.headshotKills, player.kills)}%</td>
										<td>{player.mvps}</td>
										<td>{player.score}</td>
									{:else}
										{@const s = statsOf.get(player.steamid)}
										{@const won = s?.clutches.filter((c) => c.won) ?? []}
										<td>{s ? Math.round(s.kast * 100) : 0}%</td>
										<td
											class:pos={(s?.openingKills ?? 0) > (s?.openingDeaths ?? 0)}
											class:neg={(s?.openingKills ?? 0) < (s?.openingDeaths ?? 0)}
											>{s?.openingKills ?? 0}–{s?.openingDeaths ?? 0}</td
										>
										<td>{s?.trades ?? 0}</td>
										<td class="multi">{s?.multiKills.join(' / ') ?? '0 / 0 / 0 / 0'}</td>
										<td
											title={s?.clutches
												.map((c) => `Round ${c.round}: 1v${c.opponents} ${c.won ? 'won' : 'lost'}`)
												.join('\n')}
											>{won.length}/{s?.clutches.length ?? 0}{#if won.length}{@const best =
													won.reduce((a, b) => (b.opponents > a.opponents ? b : a))}<a
													class="best"
													href="#round-{best.round}"
													title="Watch round {best.round}">1v{best.opponents}</a
												>{/if}</td
										>
										<td>{s?.flashAssists ?? 0}</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
		</section>
	{/if}

	<footer class="actions">
		<span class="file">
			{data.demo.fileName}{details.uploader ? ` · uploaded by ${details.uploader}` : ''}
		</span>
		{@render downloads()}
		<form method="POST" action="?/reparse">
			<button type="submit">Parse again</button>
		</form>
		{@render deleteForm()}
	</footer>
{/if}

{#snippet downloads()}
	<a class="download" href="/api/demos/{data.demo.id}/file" download>Download .dem</a>
	{#if data.demo.format !== 'dem'}
		<a
			class="download"
			href="/api/demos/{data.demo.id}/file?original"
			download
			title="The file as it was uploaded, still compressed"
			>.dem.{data.demo.format} · {formatBytes(data.demo.fileSize)}</a
		>
	{/if}
{/snippet}

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

	.board-switch {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 4px;
		margin-top: 20px;
	}

	.board-switch button {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--muted);
		padding: 4px 12px;
		border-radius: 999px;
		cursor: pointer;
	}

	.board-switch button[aria-selected='true'] {
		background: var(--surface);
		color: var(--text);
	}

	.openings {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
	}

	.economy {
		margin-top: 14px;
		background: var(--surface);
		border-radius: 10px;
		padding: 14px 16px;
		overflow-x: auto;
	}

	.eco-row {
		display: grid;
		grid-template-columns: 110px 1fr;
		align-items: stretch;
		gap: 10px;
	}

	.eco-team {
		align-self: center;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.eco-rounds {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(18px, 1fr);
		gap: 3px;
		min-width: max-content;
	}

	.eco-cell {
		height: 64px;
		display: flex;
		align-items: flex-end;
		border-radius: 4px;
		outline: 1px solid transparent;
		outline-offset: -1px;
	}

	a.eco-cell:hover {
		background: color-mix(in srgb, var(--text) 8%, transparent);
	}

	.eco-cell.flip {
		align-items: flex-start;
	}

	.eco-cell.won {
		outline-color: var(--text);
	}

	.eco-bar {
		display: block;
		width: 100%;
		border-radius: 3px;
	}

	.numbers .eco-rounds {
		padding: 2px 0;
	}

	.eco-number {
		text-align: center;
		font-size: 11px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.buy-pistol {
		background: #8d8f96;
	}
	.buy-eco {
		background: #c0504d;
	}
	.buy-semi {
		background: #d08a3a;
	}
	.buy-force {
		background: #d4b13c;
	}
	.buy-full {
		background: #3f9b62;
	}
	.buy-none {
		background: var(--border);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		margin: 12px 0 0;
		color: var(--muted);
		font-size: 0.85em;
	}

	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
		vertical-align: -1px;
	}

	.multi {
		white-space: nowrap;
	}

	.best {
		margin-left: 6px;
		color: var(--muted);
		font-size: 0.85em;
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
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		margin-top: 24px;
		color: var(--muted);
		font-size: 13px;
	}

	.actions button,
	.actions .download {
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}

	.actions .download {
		text-decoration: none;
	}

	.actions .download:hover,
	.actions button:hover {
		background: var(--surface-2);
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
