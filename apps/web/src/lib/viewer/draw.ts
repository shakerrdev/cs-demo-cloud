import { worldToRadar, type MapInfo, type RoundReplay, type Side } from '@cs-demo-cloud/replay';
import { bombState, grenadePosition, playerStates, type PlayerState } from './frame.ts';

export const sideColors: Record<Side, string> = { CT: '#5aa9e6', T: '#e8b04a' };

const grenadeColors = {
	smoke: '#d4d9e0',
	flash: '#ffffff',
	he: '#ff6a3d',
	molotov: '#ff9a2e',
	decoy: '#9aa4ae'
} as const;

const SMOKE_RADIUS = 144;
const FIRE_RADIUS = 110;
const SHOT_LENGTH = 360;

export interface DrawOptions {
	ctx: CanvasRenderingContext2D;
	size: number;
	pixelRatio: number;
	replay: RoundReplay;
	tick: number;
	map: MapInfo | null;
	radar: HTMLImageElement | null;
	level: 'upper' | 'lower';
	focus: number | null;
	labels?: boolean;
}

export function drawFrame(options: DrawOptions): PlayerState[] {
	const { ctx, size, pixelRatio, replay, tick, map, radar, level, focus, labels = true } = options;
	const { meta } = replay;
	const radarSize = radar?.naturalWidth || 1024;
	const scale = map?.scale ?? 5;
	const unitsToPx = (units: number) => (units / scale / radarSize) * size;
	const radius = Math.max(4.5 * pixelRatio, size * 0.0105);

	const project = (x: number, y: number) => {
		if (!map) return { px: size / 2 + unitsToPx(x), py: size / 2 - unitsToPx(y) };
		const { u, v } = worldToRadar(map, radarSize, x, y);
		return { px: u * size, py: v * size };
	};
	const onOtherLevel = (z: number) => {
		if (!map || map.lowerBelowZ === null) return false;
		return z < map.lowerBelowZ !== (level === 'lower');
	};
	const levelAlpha = (z: number) => (onOtherLevel(z) ? 0.3 : 1);

	ctx.clearRect(0, 0, size, size);
	ctx.fillStyle = '#0b0d10';
	ctx.fillRect(0, 0, size, size);
	if (radar) {
		ctx.globalAlpha = 0.92;
		ctx.drawImage(radar, 0, 0, size, size);
		ctx.globalAlpha = 1;
	}

	for (const effect of meta.effects) {
		if (tick < effect.startTick || tick > effect.endTick) continue;
		const { px, py } = project(effect.x, effect.y);
		const age = (tick - effect.startTick) / meta.tickRate;
		const left = (effect.endTick - tick) / meta.tickRate;
		ctx.globalAlpha = levelAlpha(effect.z);
		if (effect.type === 'smoke') {
			const fade = Math.min(1, age / 0.8, left / 1.5);
			ctx.fillStyle = `rgba(196, 202, 212, ${0.62 * fade})`;
			circle(ctx, px, py, unitsToPx(SMOKE_RADIUS) * Math.min(1, 0.4 + age));
			ctx.fill();
			ctx.strokeStyle = `rgba(230, 234, 240, ${0.5 * fade})`;
			ctx.lineWidth = pixelRatio;
			ctx.stroke();
		} else if (effect.type === 'molotov') {
			const fade = Math.min(1, age / 0.4, left / 0.8);
			ctx.fillStyle = `rgba(255, 98, 40, ${0.42 * fade})`;
			circle(ctx, px, py, unitsToPx(FIRE_RADIUS));
			ctx.fill();
		} else if (effect.type === 'flash' || effect.type === 'he') {
			const progress = Math.min(
				1,
				age / Math.max(0.05, (effect.endTick - effect.startTick) / meta.tickRate)
			);
			ctx.strokeStyle =
				effect.type === 'flash'
					? `rgba(255, 255, 255, ${1 - progress})`
					: `rgba(255, 106, 61, ${1 - progress})`;
			ctx.lineWidth = 2.5 * pixelRatio;
			circle(ctx, px, py, unitsToPx(effect.type === 'flash' ? 60 : 200) * (0.3 + progress));
			ctx.stroke();
		} else if (effect.type === 'decoy') {
			ctx.strokeStyle = 'rgba(154, 164, 174, 0.6)';
			ctx.setLineDash([3 * pixelRatio, 3 * pixelRatio]);
			ctx.lineWidth = pixelRatio;
			circle(ctx, px, py, radius * 0.9);
			ctx.stroke();
			ctx.setLineDash([]);
		}
	}
	ctx.globalAlpha = 1;

	const trail = 48;
	for (const grenade of meta.grenades) {
		const position = grenadePosition(grenade.path, tick);
		if (!position) continue;
		const color = grenadeColors[grenade.type];
		ctx.globalAlpha = levelAlpha(position.z);
		ctx.beginPath();
		let started = false;
		for (let i = 0; i <= position.segment; i++) {
			const pointTick = grenade.path[i * 4]!;
			if (pointTick < tick - trail) continue;
			const { px, py } = project(grenade.path[i * 4 + 1]!, grenade.path[i * 4 + 2]!);
			if (started) ctx.lineTo(px, py);
			else ctx.moveTo(px, py);
			started = true;
		}
		const head = project(position.x, position.y);
		if (started) ctx.lineTo(head.px, head.py);
		ctx.strokeStyle = color;
		ctx.globalAlpha *= 0.55;
		ctx.lineWidth = 1.5 * pixelRatio;
		ctx.stroke();
		ctx.globalAlpha = levelAlpha(position.z);
		ctx.fillStyle = color;
		circle(ctx, head.px, head.py, radius * 0.38);
		ctx.fill();
	}
	ctx.globalAlpha = 1;

	const bomb = bombState(replay, tick);
	if (bomb && bomb.kind !== 'exploded') {
		const { px, py } = project(bomb.x, bomb.y);
		ctx.globalAlpha = levelAlpha(bomb.z);
		if (bomb.kind === 'planted') {
			const pulse = 0.5 + 0.5 * Math.sin(((tick - bomb.tick) / meta.tickRate) * Math.PI * 2);
			ctx.strokeStyle = `rgba(255, 70, 70, ${0.4 + 0.5 * pulse})`;
			ctx.lineWidth = 2 * pixelRatio;
			circle(ctx, px, py, radius * (1.4 + pulse * 0.5));
			ctx.stroke();
		}
		ctx.fillStyle = bomb.kind === 'defused' ? '#4cc38a' : '#ef4b4b';
		ctx.fillRect(px - radius * 0.55, py - radius * 0.4, radius * 1.1, radius * 0.8);
		ctx.globalAlpha = 1;
	}

	const players = playerStates(replay, tick);

	for (const kill of meta.kills) {
		if (kill.tick > tick) continue;
		const victim = meta.players[kill.victim];
		if (!victim) continue;
		const { px, py } = project(kill.x, kill.y);
		const arm = radius * 0.6;
		ctx.globalAlpha = 0.75 * levelAlpha(kill.z);
		ctx.strokeStyle = sideColors[victim.side];
		ctx.lineWidth = 2 * pixelRatio;
		ctx.beginPath();
		ctx.moveTo(px - arm, py - arm);
		ctx.lineTo(px + arm, py + arm);
		ctx.moveTo(px + arm, py - arm);
		ctx.lineTo(px - arm, py + arm);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;

	const shotWindow = 6;
	for (let i = 0; i < meta.shots.length; i += 2) {
		const shotTick = meta.shots[i]!;
		if (shotTick > tick || shotTick < tick - shotWindow) continue;
		const shooter = players[meta.shots[i + 1]!];
		if (!shooter?.alive) continue;
		const { px, py } = project(shooter.x, shooter.y);
		const angle = (-shooter.yaw * Math.PI) / 180;
		const length = unitsToPx(SHOT_LENGTH);
		const fade = 1 - (tick - shotTick) / shotWindow;
		const gradient = ctx.createLinearGradient(
			px,
			py,
			px + Math.cos(angle) * length,
			py + Math.sin(angle) * length
		);
		gradient.addColorStop(0, `rgba(255, 244, 200, ${0.9 * fade})`);
		gradient.addColorStop(1, 'rgba(255, 244, 200, 0)');
		ctx.strokeStyle = gradient;
		ctx.globalAlpha = levelAlpha(shooter.z);
		ctx.lineWidth = 1.5 * pixelRatio;
		ctx.beginPath();
		ctx.moveTo(px, py);
		ctx.lineTo(px + Math.cos(angle) * length, py + Math.sin(angle) * length);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;

	const drawOrder = [...players].sort(
		(a, b) => Number(a.index === focus) - Number(b.index === focus)
	);
	for (const player of drawOrder) {
		if (!player.alive || !player.present) continue;
		const { px, py } = project(player.x, player.y);
		const color = sideColors[player.side];
		const angle = (-player.yaw * Math.PI) / 180;
		ctx.globalAlpha = levelAlpha(player.z);

		if (player.blind > 0) {
			ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * player.blind})`;
			circle(ctx, px, py, radius * 1.9);
			ctx.fill();
		}

		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(px + Math.cos(angle) * radius * 2.1, py + Math.sin(angle) * radius * 2.1);
		ctx.lineTo(
			px + Math.cos(angle - 0.55) * radius * 0.9,
			py + Math.sin(angle - 0.55) * radius * 0.9
		);
		ctx.lineTo(
			px + Math.cos(angle + 0.55) * radius * 0.9,
			py + Math.sin(angle + 0.55) * radius * 0.9
		);
		ctx.closePath();
		ctx.fill();

		circle(ctx, px, py, radius);
		ctx.fill();
		ctx.lineWidth = (player.index === focus ? 2.5 : 1.5) * pixelRatio;
		ctx.strokeStyle = player.index === focus ? '#ffffff' : 'rgba(0, 0, 0, 0.75)';
		ctx.stroke();

		if (player.health < 100) {
			ctx.strokeStyle = 'rgba(239, 75, 75, 0.95)';
			ctx.lineWidth = 2 * pixelRatio;
			ctx.beginPath();
			ctx.arc(
				px,
				py,
				radius + 2.5 * pixelRatio,
				-Math.PI / 2 + (Math.PI * 2 * player.health) / 100,
				Math.PI * 1.5
			);
			ctx.stroke();
		}

		if (player.bomb) {
			ctx.fillStyle = '#ef4b4b';
			ctx.fillRect(px + radius * 0.35, py - radius * 1.25, radius * 0.9, radius * 0.7);
		}
		if (player.defusing) {
			ctx.strokeStyle = '#5aa9e6';
			ctx.setLineDash([2 * pixelRatio, 2 * pixelRatio]);
			ctx.lineWidth = 1.5 * pixelRatio;
			circle(ctx, px, py, radius * 1.7);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		if (!labels) continue;
		const fontSize = Math.round(Math.max(10 * pixelRatio, radius * 1.05));
		ctx.font = `600 ${fontSize}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.lineWidth = 3 * pixelRatio;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
		const label = player.name.length > 14 ? `${player.name.slice(0, 13)}…` : player.name;
		ctx.strokeText(label, px, py + radius + 3 * pixelRatio);
		ctx.fillStyle = '#f2f4f7';
		ctx.fillText(label, px, py + radius + 3 * pixelRatio);
	}
	ctx.globalAlpha = 1;

	return players;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
	ctx.beginPath();
	ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}
