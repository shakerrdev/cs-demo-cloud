import * as THREE from 'three';
import type { BloomBlendMode, PackBloom, Vec3 } from '@cs-demo-cloud/replay';

const LEVELS = 4;
const MIN_SIZE = 16;

const vertexShader = /* glsl */ `
void main() {
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const thresholdShader = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform vec2 uOutSize;
uniform vec2 uThreshold;
uniform float uScale;
uniform float uExposure;
out vec4 outColor;

float bloomLuminance(vec3 c) {
	return dot(c, vec3(0.3, 0.59, 0.11));
}
float karisWeight(vec3 c) { return 1.0 / (1.0 + bloomLuminance(c)); }

vec3 karisAverage(vec3 a, vec3 b, vec3 c, vec3 d) {
	float wa = karisWeight(a);
	float wb = karisWeight(b);
	float wc = karisWeight(c);
	float wd = karisWeight(d);
	return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}

#define TAP(dx, dy) textureLodOffset(uSource, uv, 0.0, ivec2(dx, dy)).rgb

void main() {
	vec2 uv = gl_FragCoord.xy / uOutSize;
	vec3 center = textureLod(uSource, uv, 0.0).rgb;
	vec3 tl = TAP(-1, -1);
	vec3 tr = TAP(1, -1);
	vec3 bl = TAP(-1, 1);
	vec3 br = TAP(1, 1);
	vec3 top = TAP(0, -2);
	vec3 left = TAP(-2, 0);
	vec3 right = TAP(2, 0);
	vec3 bottom = TAP(0, 2);
	vec3 tlFar = TAP(-2, -2);
	vec3 trFar = TAP(2, -2);
	vec3 blFar = TAP(-2, 2);
	vec3 brFar = TAP(2, 2);
	vec3 color = karisAverage(tl, tr, bl, br) * 0.5 +
		(karisAverage(tlFar, top, left, center) + karisAverage(trFar, top, right, center) +
		 karisAverage(blFar, bottom, left, center) + karisAverage(brFar, bottom, right, center)) * 0.125;
	float weight = clamp(uExposure * bloomLuminance(color) * uThreshold.y + uThreshold.x, 0.0, 1.0);
	outColor = vec4(color * weight * uScale, 1.0);
}
`;

const downsampleShader = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform vec2 uOutSize;
out vec4 outColor;
void main() {
	outColor = vec4(textureLod(uSource, gl_FragCoord.xy / uOutSize, 0.0).rgb, 1.0);
}
`;

const blurShader = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform vec2 uOutSize;
uniform vec2 uDirection;
out vec4 outColor;
const float offsets[4] = float[4](-2.196197, -0.430063, 1.0, 2.196197);
const float weights[4] = float[4](0.121596, 0.529213, 0.227595, 0.121596);
void main() {
	vec3 sum = vec3(0.0);
	for (int i = 0; i < 4; i++) {
		vec2 position = min(gl_FragCoord.xy + uDirection * offsets[i], uOutSize);
		sum += textureLod(uSource, position / uOutSize, 0.0).rgb * weights[i];
	}
	outColor = vec4(sum, 1.0);
}
`;

const upsampleShader = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform sampler2D uHigher;
uniform vec2 uOutSize;
uniform vec3 uHigherTint;
uniform vec3 uSourceTint;
out vec4 outColor;
void main() {
	vec2 texel = 1.0 / uOutSize;
	vec2 uv = gl_FragCoord.xy * texel;
	vec2 lo = min(uv - texel, vec2(1.0));
	vec2 hi = min(uv + texel, vec2(1.0));
	vec3 sum = textureLod(uSource, uv, 0.0).rgb * 0.25;
	sum += textureLod(uSource, lo, 0.0).rgb * 0.0625;
	sum += textureLod(uSource, vec2(hi.x, lo.y), 0.0).rgb * 0.0625;
	sum += textureLod(uSource, hi, 0.0).rgb * 0.0625;
	sum += textureLod(uSource, vec2(lo.x, hi.y), 0.0).rgb * 0.0625;
	sum += textureLod(uSource, vec2(uv.x, lo.y), 0.0).rgb * 0.125;
	sum += textureLod(uSource, vec2(uv.x, hi.y), 0.0).rgb * 0.125;
	sum += textureLod(uSource, vec2(lo.x, uv.y), 0.0).rgb * 0.125;
	sum += textureLod(uSource, vec2(hi.x, uv.y), 0.0).rgb * 0.125;
	outColor = vec4(textureLod(uHigher, uv, 0.0).rgb * uHigherTint + sum * uSourceTint, 1.0);
}
`;

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
	return new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader,
		fragmentShader,
		uniforms,
		depthTest: false,
		depthWrite: false
	});
}

function target(): THREE.WebGLRenderTarget {
	return new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.HalfFloatType,
		depthBuffer: false,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		wrapS: THREE.ClampToEdgeWrapping,
		wrapT: THREE.ClampToEdgeWrapping
	});
}

export function bloomBlendMode(settings: PackBloom): BloomBlendMode {
	if (settings.blendMode) return settings.blendMode;
	const { strength, screenStrength, blurStrength } = settings;
	if (screenStrength > strength && screenStrength >= blurStrength) return 'screen';
	if (blurStrength > strength) return 'blur';
	return 'add';
}

export function bloomStrengths(settings: PackBloom): {
	raw: THREE.Vector3;
	normalized: THREE.Vector3;
} {
	const raw = new THREE.Vector3(settings.strength, settings.screenStrength, settings.blurStrength);
	return { raw, normalized: raw.clone().normalize() };
}

export class Bloom {
	readonly output: THREE.Texture;
	private settings: PackBloom;
	private scene = new THREE.Scene();
	private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private levels = Array.from({ length: LEVELS }, () => ({
		blurred: target(),
		ping: target(),
		pong: target(),
		up: target()
	}));
	private sizes: THREE.Vector2[] = [];
	private threshold: THREE.ShaderMaterial;
	private downsample: THREE.ShaderMaterial;
	private blur: THREE.ShaderMaterial;
	private upsample: THREE.ShaderMaterial;

	constructor(settings: PackBloom) {
		this.settings = settings;
		const outSize = () => ({ value: new THREE.Vector2() });
		this.threshold = pass(thresholdShader, {
			uSource: { value: null },
			uOutSize: outSize(),
			uThreshold: {
				value: new THREE.Vector2(
					-settings.threshold / settings.thresholdWidth,
					1 / settings.thresholdWidth
				)
			},
			uScale: { value: this.modeStrength() },
			uExposure: { value: 1 }
		});
		this.downsample = pass(downsampleShader, { uSource: { value: null }, uOutSize: outSize() });
		this.blur = pass(blurShader, {
			uSource: { value: null },
			uOutSize: outSize(),
			uDirection: { value: new THREE.Vector2(1, 0) }
		});
		this.upsample = pass(upsampleShader, {
			uSource: { value: null },
			uHigher: { value: null },
			uOutSize: outSize(),
			uHigherTint: { value: new THREE.Vector3() },
			uSourceTint: { value: new THREE.Vector3(1, 1, 1) }
		});
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.threshold);
		this.quad.frustumCulled = false;
		this.scene.add(this.quad);
		this.output = this.levels[0]!.up.texture;
	}

	private modeStrength(): number {
		const mode = bloomBlendMode(this.settings);
		if (mode === 'screen') return this.settings.screenStrength;
		if (mode === 'blur') return this.settings.blurStrength;
		return this.settings.strength;
	}

	private tint(level: number): THREE.Vector3 {
		const tint: Vec3 = this.settings.blurTints?.[level] ?? [1, 1, 1];
		const weight = this.settings.blurWeights?.[level] ?? 0.2;
		return new THREE.Vector3(...tint).multiplyScalar(weight);
	}

	setSize(width: number, height: number) {
		this.sizes = [];
		let w = Math.floor(width / 4);
		let h = Math.floor(height / 4);
		for (const level of this.levels) {
			if (w < MIN_SIZE || h < MIN_SIZE) break;
			for (const t of [level.blurred, level.ping, level.pong, level.up]) t.setSize(w, h);
			this.sizes.push(new THREE.Vector2(w, h));
			w = Math.floor(w / 2);
			h = Math.floor(h / 2);
		}
	}

	get active(): boolean {
		return this.sizes.length > 0;
	}

	private draw(
		renderer: THREE.WebGLRenderer,
		material: THREE.ShaderMaterial,
		output: THREE.WebGLRenderTarget,
		size: THREE.Vector2
	) {
		(material.uniforms.uOutSize!.value as THREE.Vector2).copy(size);
		this.quad.material = material;
		renderer.setRenderTarget(output);
		renderer.render(this.scene, this.camera);
	}

	render(renderer: THREE.WebGLRenderer, source: THREE.Texture, exposure: number) {
		const count = this.sizes.length;
		if (!count) return;
		const levels = this.levels;

		this.threshold.uniforms.uSource!.value = source;
		this.threshold.uniforms.uExposure!.value = exposure;
		this.draw(renderer, this.threshold, levels[0]!.ping, this.sizes[0]!);

		for (let i = 0; i < count; i++) {
			const level = levels[i]!;
			const size = this.sizes[i]!;
			if (i > 0) {
				this.downsample.uniforms.uSource!.value = levels[i - 1]!.blurred.texture;
				this.draw(renderer, this.downsample, level.ping, size);
			}
			this.blur.uniforms.uSource!.value = level.ping.texture;
			(this.blur.uniforms.uDirection!.value as THREE.Vector2).set(1, 0);
			this.draw(renderer, this.blur, level.pong, size);
			this.blur.uniforms.uSource!.value = level.pong.texture;
			(this.blur.uniforms.uDirection!.value as THREE.Vector2).set(0, 1);
			this.draw(renderer, this.blur, level.blurred, size);
		}

		const last = count - 1;
		if (last === 0) {
			this.upsample.uniforms.uSource!.value = levels[0]!.blurred.texture;
			this.upsample.uniforms.uHigher!.value = levels[0]!.blurred.texture;
			(this.upsample.uniforms.uHigherTint!.value as THREE.Vector3).set(0, 0, 0);
			(this.upsample.uniforms.uSourceTint!.value as THREE.Vector3).set(1, 1, 1);
			this.draw(renderer, this.upsample, levels[0]!.up, this.sizes[0]!);
			return;
		}
		for (let i = last; i >= 1; i--) {
			const source = i === last ? levels[i]!.blurred : levels[i]!.up;
			let higherTint = this.tint(i);
			if (i === 1) higherTint = higherTint.add(this.tint(0));
			this.upsample.uniforms.uSource!.value = source.texture;
			this.upsample.uniforms.uHigher!.value = levels[i - 1]!.blurred.texture;
			(this.upsample.uniforms.uHigherTint!.value as THREE.Vector3).copy(higherTint);
			(this.upsample.uniforms.uSourceTint!.value as THREE.Vector3).copy(
				i === last ? this.tint(i + 1) : new THREE.Vector3(1, 1, 1)
			);
			this.draw(renderer, this.upsample, levels[i - 1]!.up, this.sizes[i - 1]!);
		}
	}

	dispose() {
		for (const level of this.levels) {
			for (const t of [level.blurred, level.ping, level.pong, level.up]) t.dispose();
		}
		for (const material of [this.threshold, this.downsample, this.blur, this.upsample])
			material.dispose();
		this.quad.geometry.dispose();
	}
}
