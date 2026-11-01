<script lang="ts" module>
	export type DrawTool = 'pen' | 'arrow';

	export interface Stroke {
		tool: DrawTool;
		color: string;
		points: number[];
	}
</script>

<script lang="ts">
	interface Props {
		size: number;
		pixelRatio: number;
		active: boolean;
		tool: DrawTool;
		color: string;
		strokes: Stroke[];
		onchange: (strokes: Stroke[]) => void;
	}

	let { size, pixelRatio, active, tool, color, strokes, onchange }: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let current = $state.raw<Stroke | null>(null);

	function point(event: PointerEvent): [number, number] {
		const rect = canvas!.getBoundingClientRect();
		return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
	}

	function down(event: PointerEvent) {
		if (!active || event.button !== 0) return;
		canvas!.setPointerCapture(event.pointerId);
		const [u, v] = point(event);
		current = { tool, color, points: [u, v, u, v] };
		event.preventDefault();
	}

	function move(event: PointerEvent) {
		if (!current) return;
		const [u, v] = point(event);
		if (current.tool === 'arrow') {
			current = { ...current, points: [current.points[0]!, current.points[1]!, u, v] };
			return;
		}
		const n = current.points.length;
		const du = (u - current.points[n - 2]!) * size;
		const dv = (v - current.points[n - 1]!) * size;
		if (du * du + dv * dv < 9) return;
		current = { ...current, points: [...current.points, u, v] };
	}

	function up() {
		if (!current) return;
		const [x0, y0] = current.points;
		const n = current.points.length;
		const length = Math.hypot(current.points[n - 2]! - x0!, current.points[n - 1]! - y0!) * size;
		if (length > 4 || current.points.length > 6) onchange([...strokes, current]);
		current = null;
	}

	function paint(ctx: CanvasRenderingContext2D, stroke: Stroke) {
		const px = size * pixelRatio;
		const width = Math.max(2, px * 0.004);
		ctx.strokeStyle = stroke.color;
		ctx.fillStyle = stroke.color;
		ctx.lineWidth = width;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		const p = stroke.points;
		ctx.beginPath();
		ctx.moveTo(p[0]! * px, p[1]! * px);
		for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]! * px, p[i + 1]! * px);
		ctx.stroke();
		if (stroke.tool === 'arrow' && p.length >= 4) {
			const n = p.length;
			const x1 = p[n - 2]! * px;
			const y1 = p[n - 1]! * px;
			const angle = Math.atan2(y1 - p[n - 3]! * px, x1 - p[n - 4]! * px);
			const head = width * 4.5;
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x1 - head * Math.cos(angle - 0.45), y1 - head * Math.sin(angle - 0.45));
			ctx.lineTo(x1 - head * Math.cos(angle + 0.45), y1 - head * Math.sin(angle + 0.45));
			ctx.closePath();
			ctx.fill();
		}
	}

	$effect(() => {
		if (!canvas) return;
		const px = Math.round(size * pixelRatio);
		canvas.width = px;
		canvas.height = px;
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, px, px);
		for (const stroke of strokes) paint(ctx, stroke);
		if (current) paint(ctx, current);
	});
</script>

<canvas
	bind:this={canvas}
	class="draw"
	class:active
	style:width="{size}px"
	style:height="{size}px"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
></canvas>

<style>
	.draw {
		position: absolute;
		inset: 0;
		margin: auto;
		pointer-events: none;
		touch-action: none;
	}

	.draw.active {
		pointer-events: auto;
		cursor: crosshair;
	}
</style>
