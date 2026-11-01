<script lang="ts">
	import { weaponTitle, type Side, type TeamKey } from '@cs-demo-cloud/replay';
	import { formatClock, roundEndReason } from '#lib/format.ts';
	import { sideColors } from '#lib/viewer/draw.ts';

	interface Round {
		number: number;
		freezeEndTick: number | null;
		startTick: number;
		endTick: number;
		teamASide: Side;
		winnerTeam: TeamKey | null;
		reason: string | null;
		scoreA: number;
		scoreB: number;
	}

	interface Kill {
		round: number;
		tick: number;
		attackerSteamid: string | null;
		victimSteamid: string;
		assisterSteamid: string | null;
		weapon: string;
		headshot: boolean;
		wallbang: boolean;
		throughSmoke: boolean;
		noScope: boolean;
		flashAssist: boolean;
	}

	interface Props {
		rounds: Round[];
		kills: Kill[];
		players: { steamid: string; name: string; team: TeamKey }[];
		teamNames: Record<TeamKey, string>;
		tickRate: number;
	}

	let { rounds, kills, players, teamNames, tickRate }: Props = $props();

	const LEAD_SECONDS = 3;

	const people = $derived(new Map(players.map((p) => [p.steamid, p])));
	const killsByRound = $derived.by(() => {
		const map = new Map<number, Kill[]>();
		for (const kill of kills) {
			const list = map.get(kill.round) ?? [];
			list.push(kill);
			map.set(kill.round, list);
		}
		return map;
	});

	const roundSeconds = $derived.by(() => {
		const counts = new Map<number, number>();
		for (const round of rounds) {
			if (round.reason !== 'target_saved' || round.freezeEndTick === null) continue;
			const seconds = Math.round((round.endTick - round.freezeEndTick) / tickRate);
			counts.set(seconds, (counts.get(seconds) ?? 0) + 1);
		}
		const best = [...counts].sort((a, b) => b[1] - a[1])[0];
		return best && best[0] >= 10 ? best[0] : 115;
	});

	const sideOf = (team: TeamKey | undefined, round: Round): Side | null =>
		team === undefined
			? null
			: team === 'a'
				? round.teamASide
				: round.teamASide === 'CT'
					? 'T'
					: 'CT';

	const clock = (round: Round, tick: number) =>
		formatClock(roundSeconds - (tick - (round.freezeEndTick ?? round.startTick)) / tickRate);

	const extras = (kill: Kill) =>
		[
			kill.headshot && 'headshot',
			kill.wallbang && 'wallbang',
			kill.throughSmoke && 'through smoke',
			kill.noScope && 'no-scope'
		].filter(Boolean) as string[];
</script>

<ol class="log">
	{#each rounds as round (round.number)}
		{@const list = killsByRound.get(round.number) ?? []}
		{@const winnerSide = round.winnerTeam ? sideOf(round.winnerTeam, round) : null}
		<li class="round">
			<a
				class="head"
				href="#round-{round.number}"
				style:--win={winnerSide ? sideColors[winnerSide] : 'var(--muted)'}
			>
				<span class="number">{round.number}</span>
				<span class="winner"
					>{round.winnerTeam ? teamNames[round.winnerTeam] : 'No winner'}
					<small>{roundEndReason(round.reason)}</small></span
				>
				<span class="score">{round.scoreA}:{round.scoreB}</span>
			</a>
			{#if list.length}
				<ul class="kills">
					{#each list as kill (kill.tick + kill.victimSteamid)}
						{@const killer = kill.attackerSteamid ? people.get(kill.attackerSteamid) : undefined}
						{@const victim = people.get(kill.victimSteamid)}
						{@const killerSide = sideOf(killer?.team, round)}
						{@const victimSide = sideOf(victim?.team, round)}
						{@const tags = extras(kill)}
						<li>
							<a
								href="#round-{round.number}@{Math.max(
									round.startTick,
									kill.tick - LEAD_SECONDS * tickRate
								)}"
								title="Watch from {LEAD_SECONDS} s before this kill"
							>
								<span class="time">{clock(round, kill.tick)}</span>
								<span class="who" style:color={killerSide ? sideColors[killerSide] : 'var(--muted)'}
									>{killer?.name ?? 'World'}</span
								>
								<span class="weapon"
									>{weaponTitle(kill.weapon)}{#if tags.length}<small
											>{` · ${tags.join(' · ')}`}</small
										>{/if}</span
								>
								<span class="who" style:color={victimSide ? sideColors[victimSide] : 'var(--muted)'}
									>{victim?.name ?? '?'}</span
								>
								{#if kill.assisterSteamid && people.get(kill.assisterSteamid)}
									<small class="assist"
										>+ {people.get(kill.assisterSteamid)!.name}{kill.flashAssist
											? ' (flash)'
											: ''}</small
									>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.log {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
		gap: 10px;
	}

	.round {
		background: var(--bg);
		border-radius: 8px;
		overflow: hidden;
	}

	a {
		color: inherit;
		text-decoration: none;
	}

	.head {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-left: 3px solid var(--win);
	}

	.head:hover,
	.kills a:hover {
		background: var(--surface-2);
	}

	.number {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.winner {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.winner small,
	small {
		color: var(--muted);
		font-weight: 400;
	}

	.score {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.kills {
		list-style: none;
		margin: 0;
		padding: 0 0 6px;
	}

	.kills a {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 8px;
		padding: 3px 10px 3px 13px;
		font-size: 0.88em;
	}

	.time {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		min-width: 32px;
	}

	.who {
		font-weight: 600;
	}

	.weapon {
		color: var(--text);
	}

	.assist {
		flex-basis: 100%;
		padding-left: 40px;
	}
</style>
