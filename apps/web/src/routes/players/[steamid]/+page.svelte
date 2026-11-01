<script lang="ts">
	import { enhance } from '$app/forms';
	import { mapTitle } from '@cs-demo-cloud/replay';
	import { formatDate, platformName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const isMe = $derived(data.ownSteamId === data.profile.steamid);
	const profile = $derived(data.profile);
	const s = $derived(profile.summary);
	const pct = (value: number | null) => (value === null ? '–' : `${Math.round(value * 100)}%`);
	const isSteam = $derived(/^\d{17}$/.test(profile.steamid));
</script>

<svelte:head><title>{profile.name} · cs-demo-cloud</title></svelte:head>

<header class="head">
	<div>
		<h1>{profile.name}</h1>
		<p class="meta">
			{s.matches}
			{s.matches === 1 ? 'match' : 'matches'} · {s.wins}W {s.losses}L{s.ties ? ` ${s.ties}T` : ''}
			{#if profile.names.length > 1}· also played as {profile.names.slice(1).join(', ')}{/if}
			{#if isSteam}
				· <a
					href="https://steamcommunity.com/profiles/{profile.steamid}"
					target="_blank"
					rel="noopener noreferrer">Steam profile</a
				>
			{/if}
		</p>
	</div>
	<form method="POST" action={isMe ? '?/notMe' : '?/me'} use:enhance>
		<button
			type="submit"
			class="button small"
			title={isMe
				? 'Stop treating this player as you'
				: 'Use this player for My stats and your results in the match list'}
			>{isMe ? 'This is you · undo' : 'This is me'}</button
		>
	</form>
</header>

<section class="tiles" aria-label="Summary">
	<div>
		<span class="value">{(s.kills / Math.max(1, s.deaths)).toFixed(2)}</span><span class="label"
			>K/D</span
		>
	</div>
	<div><span class="value">{Math.round(s.adr)}</span><span class="label">ADR</span></div>
	<div><span class="value">{pct(s.kast)}</span><span class="label">KAST</span></div>
	<div>
		<span class="value">{pct(s.headshotPercent)}</span><span class="label">Headshot kills</span>
	</div>
	<div>
		<span class="value">{pct(s.matches ? s.wins / s.matches : 0)}</span><span class="label"
			>Win rate</span
		>
	</div>
	<div>
		<span class="value">{s.openingKills}–{s.openingDeaths}</span><span class="label"
			>Opening duels</span
		>
	</div>
	<div>
		<span class="value">{s.clutchesWon}/{s.clutches}</span><span class="label">Clutches won</span>
	</div>
	<div>
		<span class="value small">{s.multiKills.join(' / ')}</span><span class="label"
			>2K / 3K / 4K / 5K</span
		>
	</div>
</section>

<div class="columns">
	<section class="panel">
		<h2>Matches</h2>
		<ul class="matches">
			{#each profile.matches as m (m.demoId)}
				<li>
					<a href="/demos/{m.demoId}" class="match">
						<img
							src="/maps/{m.map}.png"
							alt=""
							loading="lazy"
							onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
						/>
						<span class="main">
							<span class="title">{mapTitle(m.map)}</span>
							<span class="sub">{formatDate(m.playedAt)} · {platformName(m.platform)}</span>
						</span>
						<span class="score {m.result}">{m.own}:{m.other}</span>
						<span class="line"
							>{m.kills}–{m.deaths}–{m.assists}<small
								>ADR {Math.round(m.adr)} · KAST {pct(m.kast)}</small
							></span
						>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<section class="panel">
		<h2>Maps</h2>
		<table>
			<thead>
				<tr><th>Map</th><th>Played</th><th>Won</th><th>ADR</th><th>K/D</th></tr>
			</thead>
			<tbody>
				{#each profile.maps as record (record.map)}
					<tr>
						<td>{mapTitle(record.map)}</td>
						<td>{record.matches}</td>
						<td>{pct(record.wins / record.matches)}</td>
						<td>{Math.round(record.adr)}</td>
						<td>{record.kd.toFixed(2)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	h1 {
		margin: 0;
		font-size: 1.7rem;
	}

	h2 {
		margin: 0 0 10px;
		font-size: 1rem;
	}

	.meta,
	.sub,
	.label,
	small {
		color: var(--muted);
	}

	.meta {
		margin: 4px 0 0;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 8px;
		margin: 20px 0;
	}

	.tiles div {
		display: grid;
		gap: 2px;
		padding: 12px 14px;
		background: var(--surface);
		border-radius: var(--radius);
	}

	.value {
		font-size: 1.5rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.value.small {
		font-size: 1.1rem;
		line-height: 1.6;
	}

	.label {
		font-size: 0.8em;
	}

	.columns {
		display: grid;
		gap: 16px;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		align-items: start;
	}

	@media (max-width: 860px) {
		.columns {
			grid-template-columns: 1fr;
		}
	}

	.panel {
		background: var(--surface);
		border-radius: var(--radius);
		padding: 14px 16px;
	}

	.matches {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}

	.match {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 12px;
		padding: 8px 4px;
		border-top: 1px solid var(--border);
		color: inherit;
		text-decoration: none;
	}

	li:first-child .match {
		border-top: 0;
	}

	.match:hover {
		background: var(--surface-2);
	}

	.match img {
		width: 40px;
		height: 40px;
		border-radius: 6px;
		object-fit: cover;
		background: var(--surface-2);
	}

	.main {
		display: grid;
		min-width: 0;
	}

	.title {
		font-weight: 600;
	}

	.sub {
		font-size: 0.85em;
	}

	.score {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.score.win {
		color: var(--ok);
	}

	.score.loss {
		color: var(--danger);
	}

	.line {
		display: grid;
		text-align: right;
		font-variant-numeric: tabular-nums;
		min-width: 120px;
	}

	small {
		font-size: 0.8em;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 6px 4px;
		text-align: right;
	}

	th:first-child,
	td:first-child {
		text-align: left;
	}

	th {
		color: var(--muted);
		font-weight: 500;
		font-size: 0.85em;
	}

	tbody tr + tr td {
		border-top: 1px solid var(--border);
	}
</style>
