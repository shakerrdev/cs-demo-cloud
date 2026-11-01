import * as THREE from 'three';
import type { MapInfo, MapMesh } from '@cs-demo-cloud/replay';
import type { SunShadow } from './sun-shadow.ts';

export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.32, 0.77).normalize();

const vertexShader = /* glsl */ `
out vec3 vWorld;
out float vDepth;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vWorld = world.xyz;
	vec4 view = viewMatrix * world;
	vDepth = -view.z;
	gl_Position = projectionMatrix * view;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

in vec3 vWorld;
in float vDepth;

uniform sampler2D uRadar;
uniform sampler2D uRadarLower;
uniform float uRadarStrength;
uniform float uHasLower;
uniform float uLowerBelowZ;
uniform vec2 uRadarOrigin;
uniform float uRadarSize;
uniform vec2 uHeightRange;
uniform float uCutZ;
uniform vec3 uLightDir;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uShadow;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform float uShadowRange;
uniform float uHasShadow;
uniform float uShadowSize;

float sunVisibility(vec3 world, vec3 normal, float ndotl) {
	if (uHasShadow < 0.5) return 1.0;
	vec3 offset = world + normal * uShadowTexel * 1.5;
	vec4 coord = uShadowMatrix * vec4(offset, 1.0);
	if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) return 1.0;
	float bias = uShadowTexel * (1.0 + 2.5 * (1.0 - ndotl)) / uShadowRange;
	float lit = 0.0;
	float step = 1.0 / uShadowSize;
	for (int x = -1; x <= 1; x++) {
		for (int y = -1; y <= 1; y++) {
			float depth = texture(uShadow, coord.xy + vec2(float(x), float(y)) * step).r;
			lit += coord.z - bias <= depth ? 1.0 : 0.0;
		}
	}
	return lit / 9.0;
}

out vec4 outColor;

void main() {
	if (vWorld.z > uCutZ) discard;

	vec3 facing = cross(dFdx(vWorld), dFdy(vWorld));
	float area = length(facing);
	vec3 normal = area > 1e-9 ? facing / area : vec3(0.0, 0.0, 1.0);
	if (dot(normal, cameraPosition - vWorld) < 0.0) normal = -normal;
	float floorness = smoothstep(0.55, 0.85, normal.z);

	float height = clamp((vWorld.z - uHeightRange.x) / (uHeightRange.y - uHeightRange.x), 0.0, 1.0);
	vec3 wall = mix(vec3(0.36, 0.37, 0.40), vec3(0.64, 0.62, 0.58), height);
	vec3 ground = mix(vec3(0.34, 0.35, 0.37), vec3(0.66, 0.64, 0.6), height);
	vec3 color = mix(wall, ground, floorness);

	vec2 uv = vec2(vWorld.x - uRadarOrigin.x, uRadarOrigin.y - vWorld.y) / uRadarSize;
	float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
	vec4 radar = uHasLower > 0.5 && vWorld.z < uLowerBelowZ
		? texture(uRadarLower, uv)
		: texture(uRadar, uv);
	color = mix(color, radar.rgb * 1.05, floorness * radar.a * inside * uRadarStrength);

	vec3 an = abs(normal);
	vec2 plane = an.z > max(an.x, an.y) ? vWorld.xy : an.x > an.y ? vWorld.yz : vWorld.xz;
	vec2 cell = plane / 64.0;
	vec2 grid = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(1e-4));
	float line = 1.0 - min(min(grid.x, grid.y), 1.0);
	color *= 1.0 - mix(0.06, 0.1, floorness) * line;

	float ndotl = max(dot(normal, uLightDir), 0.0);
	float sun = ndotl * sunVisibility(vWorld, normal, ndotl);
	vec3 sky = mix(vec3(0.5, 0.53, 0.6), vec3(0.66, 0.7, 0.78), normal.z * 0.5 + 0.5);
	float side = 0.9 + 0.1 * abs(normal.x);
	color *= (sky * mix(side, 1.0, floorness) + vec3(1.0, 0.93, 0.8) * 0.85 * sun);
	color = vec3(1.0) - exp(-color * 1.35);

	float fog = 1.0 - exp(-pow(uFogDensity * vDepth, 2.0));
	outColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

export function createMapMaterial(background: THREE.Color): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader,
		fragmentShader,
		side: THREE.DoubleSide,
		uniforms: {
			uRadar: { value: null },
			uRadarLower: { value: null },
			uRadarStrength: { value: 0 },
			uHasLower: { value: 0 },
			uLowerBelowZ: { value: 0 },
			uRadarOrigin: { value: new THREE.Vector2() },
			uRadarSize: { value: 1 },
			uHeightRange: { value: new THREE.Vector2(-200, 400) },
			uCutZ: { value: 1e9 },
			uLightDir: { value: SUN_DIRECTION.clone() },
			uFogColor: { value: background.clone() },
			uFogDensity: { value: 0 },
			uShadow: { value: null },
			uShadowMatrix: { value: new THREE.Matrix4() },
			uShadowTexel: { value: 1 },
			uShadowRange: { value: 1 },
			uHasShadow: { value: 0 },
			uShadowSize: { value: 1 }
		}
	});
}

export function createMapGeometry(mesh: MapMesh): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3, true));
	geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
	return geometry;
}

export function placeMap(object: THREE.Object3D, mesh: MapMesh) {
	object.position.set(...mesh.min);
	object.scale.set(
		Math.max(1e-3, mesh.max[0] - mesh.min[0]),
		Math.max(1e-3, mesh.max[1] - mesh.min[1]),
		Math.max(1e-3, mesh.max[2] - mesh.min[2])
	);
}

export function radarTexture(
	image: HTMLImageElement | null,
	anisotropy: number
): THREE.Texture | null {
	if (!image) return null;
	const texture = new THREE.Texture(image);
	texture.anisotropy = anisotropy;
	texture.needsUpdate = true;
	return texture;
}

export function applyRadar(
	material: THREE.ShaderMaterial,
	map: MapInfo | null,
	upper: THREE.Texture | null,
	lower: THREE.Texture | null
) {
	const u = material.uniforms;
	u.uRadar!.value = upper;
	u.uRadarLower!.value = lower ?? upper;
	u.uRadarStrength!.value = map && upper ? 0.9 : 0;
	u.uHasLower!.value = map?.lowerBelowZ !== null && lower ? 1 : 0;
	u.uLowerBelowZ!.value = map?.lowerBelowZ ?? 0;
	if (map) {
		(u.uRadarOrigin!.value as THREE.Vector2).set(map.posX, map.posY);
		u.uRadarSize!.value = map.scale * 1024;
	}
}

export function applyShadow(
	material: THREE.ShaderMaterial,
	shadow: SunShadow | null,
	size: number
) {
	const u = material.uniforms;
	u.uHasShadow!.value = shadow ? 1 : 0;
	if (!shadow) return;
	u.uShadow!.value = shadow.target.depthTexture;
	(u.uShadowMatrix!.value as THREE.Matrix4).copy(shadow.matrix);
	u.uShadowTexel!.value = shadow.texel;
	u.uShadowRange!.value = shadow.range;
	u.uShadowSize!.value = size;
}
