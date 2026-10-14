import * as THREE from 'three';
import type { MapInfo, MapMesh } from '@cs-demo-cloud/replay';

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

	vec2 cell = vWorld.xy / 128.0;
	vec2 grid = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(1e-4));
	float line = 1.0 - min(min(grid.x, grid.y), 1.0);
	color *= 1.0 - 0.1 * line * floorness;

	float diffuse = max(dot(normal, uLightDir), 0.0);
	float side = 0.85 + 0.15 * abs(normal.x);
	color *= (0.56 + 0.56 * diffuse) * mix(side, 1.0, floorness);

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
			uLightDir: { value: new THREE.Vector3(0.45, 0.3, 1).normalize() },
			uFogColor: { value: background.clone() },
			uFogDensity: { value: 0 }
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
