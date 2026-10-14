import * as THREE from 'three';
import type { PackTonemap } from '@cs-demo-cloud/replay';

const skyVertex = /* glsl */ `
out vec3 vDirection;
void main() {
	vDirection = position;
	vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
	gl_Position = clip.xyww;
}
`;

const skyFragment = /* glsl */ `
precision highp float;
in vec3 vDirection;
uniform samplerCube uSky;
uniform mat3 uRotation;
uniform vec3 uScale;
out vec4 outColor;
void main() {
	vec3 color = textureLod(uSky, uRotation * normalize(vDirection), 0.0).rgb;
	outColor = vec4(max(color * uScale, vec3(0.0)), 1.0);
}
`;

export function createSkyMesh(): THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> {
	const material = new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: skyVertex,
		fragmentShader: skyFragment,
		uniforms: {
			uSky: { value: null },
			uRotation: { value: new THREE.Matrix3() },
			uScale: { value: new THREE.Vector3(1, 1, 1) }
		},
		side: THREE.BackSide,
		depthWrite: false,
		depthFunc: THREE.LessEqualDepth
	});
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
	mesh.frustumCulled = false;
	mesh.renderOrder = -1000;
	mesh.visible = false;
	return mesh;
}

const postVertex = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const postFragment = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler2D uColor;
uniform sampler3D uLut;
uniform float uLutEnabled;
uniform vec2 uLutRange;
uniform float uExposure;
uniform vec4 uCurveA;
uniform vec4 uCurveB;
out vec4 outColor;

vec3 curve(vec3 x) {
	vec3 numerator = x * (uCurveA.x * x + uCurveA.y * uCurveA.z) + uCurveA.w * uCurveB.x;
	vec3 denominator = x * (uCurveA.x * x + uCurveA.y) + uCurveB.y * uCurveA.w;
	return numerator / denominator - uCurveB.x / uCurveB.y;
}

vec3 linearToSrgb(vec3 c) {
	c = max(c, vec3(0.0));
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
	vec3 color = texture(uColor, vUv).rgb * uExposure;
	color = min(color * 2.8, vec3(uCurveB.z));
	color = curve(color) * uCurveB.w;
	color = linearToSrgb(color);
	if (uLutEnabled > 0.5) {
		vec3 lookup = clamp(color, 0.0, 1.0) * uLutRange.x + uLutRange.y;
		color = texture(uLut, lookup).rgb;
	}
	outColor = vec4(color, 1.0);
}
`;

const defaultTonemap: PackTonemap = {
	exposureBias: 0,
	shoulderStrength: 0.15,
	linearStrength: 0.5,
	linearAngle: 0.1,
	toeStrength: 0.2,
	toeNum: 0.02,
	toeDenom: 0.3,
	whitePoint: 4
};

export class PostProcess {
	readonly target: THREE.WebGLRenderTarget;
	private scene = new THREE.Scene();
	private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private material: THREE.ShaderMaterial;

	constructor() {
		this.target = new THREE.WebGLRenderTarget(1, 1, {
			type: THREE.HalfFloatType,
			samples: 4,
			depthBuffer: true
		});
		this.material = new THREE.ShaderMaterial({
			glslVersion: THREE.GLSL3,
			vertexShader: postVertex,
			fragmentShader: postFragment,
			uniforms: {
				uColor: { value: this.target.texture },
				uLut: { value: null },
				uLutEnabled: { value: 0 },
				uLutRange: { value: new THREE.Vector2(1, 0) },
				uExposure: { value: 1 },
				uCurveA: { value: new THREE.Vector4() },
				uCurveB: { value: new THREE.Vector4() }
			},
			depthTest: false,
			depthWrite: false
		});
		this.setTonemap(null, 1);
		const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
		quad.frustumCulled = false;
		this.scene.add(quad);
	}

	setTonemap(settings: PackTonemap | null, exposure: number) {
		const t = settings ?? defaultTonemap;
		const u = this.material.uniforms;
		u.uExposure!.value = exposure * 2 ** t.exposureBias;
		const white = t.whitePoint * 2.8;
		const curve = (x: number) =>
			(x * (t.shoulderStrength * x + t.linearAngle * t.linearStrength) + t.toeStrength * t.toeNum) /
				(x * (t.shoulderStrength * x + t.linearStrength) + t.toeStrength * t.toeDenom) -
			t.toeNum / t.toeDenom;
		const whiteScale = 1 / curve(white);
		(u.uCurveA!.value as THREE.Vector4).set(
			t.shoulderStrength,
			t.linearStrength,
			t.linearAngle,
			t.toeStrength
		);
		(u.uCurveB!.value as THREE.Vector4).set(t.toeNum, t.toeDenom, white, whiteScale);
	}

	setLut(texture: THREE.Data3DTexture | null) {
		const u = this.material.uniforms;
		u.uLut!.value = texture;
		u.uLutEnabled!.value = texture ? 1 : 0;
		if (texture) {
			const dim = texture.image.width;
			(u.uLutRange!.value as THREE.Vector2).set((dim - 1) / dim, 0.5 / dim);
		}
	}

	setSize(width: number, height: number) {
		this.target.setSize(Math.max(1, width), Math.max(1, height));
	}

	render(renderer: THREE.WebGLRenderer) {
		renderer.setRenderTarget(null);
		renderer.render(this.scene, this.camera);
	}

	dispose() {
		this.target.dispose();
		this.material.dispose();
	}
}
