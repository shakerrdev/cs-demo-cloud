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
	const form = $derived(
		profile.matches
			.filter((m) => m.rating !== null)
			.slice(0, 20)
			.reverse()
	);
	const top = $derived(Math.max(2, ...form.map((m) => m.rating ?? 0)));
	const y = (value: number) => 100 - (Math.min(value, top) / top) * 100;
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
	<div class="lead">
		<span class="value">{s.rating?.toFixed(2) ?? '–'}</span><span
			class="label"
			title="Approximation of the HLTV 2.0 rating (1.00 is average)">Rating</span
		>
	</div>
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

<section class="sides" aria-label="CT and T side">
	{#each ['CT', 'T'] as const as side (side)}
		{@const r = profile.sides[side]}
		<div class="side {side}">
			<h2>{side === 'CT' ? 'Counter-Terrorist' : 'Terrorist'}</h2>
			<dl>
				<div>
					<dt>Rounds won</dt>
					<dd>{pct(r.rounds ? r.won / r.rounds : null)}</dd>
				</div>
				<div>
					<dt>K/D</dt>
					<dd>{(r.kills / Math.max(1, r.deaths)).toFixed(2)}</dd>
				</div>
				<div>
					<dt>KAST</dt>
					<dd>{pct(r.rounds ? r.kastRounds / r.rounds : null)}</dd>
				</div>
				<div>
					<dt>Rounds</dt>
					<dd>{r.rounds}</dd>
				</div>
			</dl>
		</div>
	{/each}
	<div class="side pistol">
		<h2>Pistol rounds</h2>
		<dl>
			<div>
				<dt>Won</dt>
				<dd>{profile.sides.pistolsWon}/{profile.sides.pistols}</dd>
			</div>
			<div>
				<dt>Win rate</dt>
				<dd>
					{pct(profile.sides.pistols ? profile.sides.pistolsWon / profile.sides.pistols : null)}
				</dd>
			</div>
		</dl>
	</div>
</section>

{#if form.length > 1}
	<section class="panel form" aria-label="Recent form">
		<h2>Form <small>rating in the last {form.length} matches, oldest first</small></h2>
		<svg
			viewBox="0 0 {form.length * 24} 100"
			preserveAspectRatio="none"
			role="img"
			style:width="{form.length * 30}px"
		>
			<line x1="0" x2={form.length * 24} y1={y(1)} y2={y(1)} class="par" />
			{#each form as m, i (m.demoId)}
				<a href="/demos/{m.demoId}">
					<rect
						x={i * 24 + 4}
						width="16"
						y={Math.min(y(m.rating ?? 0), y(1))}
						height={Math.max(1.5, Math.abs(y(m.rating ?? 0) - y(1)))}
						class={m.result}
					>
						<title
							>{mapTitle(m.map)}
							{m.own}:{m.other} · rating {m.rating?.toFixed(2)} · {formatDate(m.playedAt)}</title
						>
					</rect>
				</a>
			{/each}
		</svg>
	</section>
{/if}

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
						<span
							class="rating"
							class:good={m.rating !== null && m.rating >= 1.15}
							class:bad={m.rating !== null && m.rating < 0.85}>{m.rating?.toFixed(2) ?? '–'}</span
						>
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

	<div class="side">
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
		{#if data.duels.killed.length || data.duels.killedBy.length}
			<section class="panel duels">
				<h2>Duels</h2>
				<div class="duel-lists">
					<div>
						<h3>Kills most</h3>
						<ol>
							{#each data.duels.killed as d (d.steamid)}
								<li><a href="/players/{d.steamid}">{d.name}</a><b>{d.count}</b></li>
							{/each}
						</ol>
					</div>
					<div>
						<h3>Killed most by</h3>
						<ol>
							{#each data.duels.killedBy as d (d.steamid)}
								<li><a href="/players/{d.steamid}">{d.name}</a><b>{d.count}</b></li>
							{/each}
						</ol>
					</div>
				</div>
			</section>
		{/if}
	</div>
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

	.tiles .lead .value {
		color: var(--accent);
	}

	.form {
		margin-bottom: 16px;
		position: relative;
	}

	.form small {
		color: var(--muted);
		font-weight: 400;
	}

	.form svg {
		display: block;
		max-width: 100%;
		height: 120px;
	}

	.form rect {
		fill: var(--muted);
	}

	.form rect.win {
		fill: var(--ok);
	}

	.form rect.loss {
		fill: var(--danger);
	}

	.form a:hover rect {
		opacity: 0.75;
	}

	.form .par {
		stroke: var(--border);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
		stroke-dasharray: 4 4;
	}

	.side {
		display: grid;
		gap: 16px;
		align-content: start;
	}

	.duel-lists {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.duels h3 {
		margin: 0 0 6px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
	}

	.duels ol {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 4px;
	}

	.duels li {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 0.9em;
	}

	.duels li a {
		color: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.duels li b {
		font-variant-numeric: tabular-nums;
	}

	.rating {
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		min-width: 40px;
		text-align: right;
	}

	.rating.good {
		color: var(--ok);
	}

	.rating.bad {
		color: var(--danger);
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

	.sides {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 8px;
		margin-bottom: 16px;
	}

	.side {
		padding: 12px 14px;
		background: var(--surface);
		border-radius: var(--radius);
		border-top: 3px solid var(--muted);
	}

	.side.CT {
		border-top-color: #5aa9e6;
	}

	.side.T {
		border-top-color: #e8b04a;
	}

	.side dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
		gap: 8px;
		margin: 0;
	}

	.side dt {
		color: var(--muted);
		font-size: 0.8em;
	}

	.side dd {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
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
		grid-template-columns: 40px minmax(0, 1fr) auto auto auto;
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
