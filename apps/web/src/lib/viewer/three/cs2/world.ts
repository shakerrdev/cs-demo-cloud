import * as THREE from 'three';
import type {
	MapPackManifest,
	PackEnvMapVolume,
	PackProbeVolume,
	PackWorld,
	Vec3
} from '@cs-demo-cloud/replay';
import { defaultTextures, type WorldShading } from './material.ts';
import { ENV_VOLUME_TEXELS, MAX_ENV_VOLUMES, MAX_PROBE_VOLUMES } from './shader.ts';

export function anglesToMatrix(angles: Vec3): THREE.Matrix4 {
	const [pitch, yaw, roll] = angles.map((a) => (a * Math.PI) / 180) as Vec3;
	const sp = Math.sin(pitch);
	const cp = Math.cos(pitch);
	const sy = Math.sin(yaw);
	const cy = Math.cos(yaw);
	const sr = Math.sin(roll);
	const cr = Math.cos(roll);
	const forward = new THREE.Vector3(cp * cy, cp * sy, -sp);
	const left = new THREE.Vector3(sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp);
	const up = new THREE.Vector3(cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp);
	return new THREE.Matrix4().makeBasis(forward, left, up);
}

function probeTable(volumes: PackProbeVolume[]): THREE.DataTexture {
	const count = Math.min(volumes.length, MAX_PROBE_VOLUMES);
	const data = new Float32Array(Math.max(1, count) * 6 * 4);
	volumes.slice(0, count).forEach((volume, i) => {
		const toWorld = anglesToMatrix(volume.angles).setPosition(...volume.origin);
		const size = new THREE.Vector3(...volume.max).sub(new THREE.Vector3(...volume.min));
		const normalize = new THREE.Matrix4()
			.makeScale(1 / size.x, 1 / size.y, 1 / size.z)
			.multiply(new THREE.Matrix4().makeTranslation(-volume.min[0], -volume.min[1], -volume.min[2]))
			.multiply(toWorld.clone().invert());
		const e = normalize.elements;
		const base = i * 24;
		for (let row = 0; row < 3; row++) {
			data[base + row * 4] = e[row]!;
			data[base + row * 4 + 1] = e[row + 4]!;
			data[base + row * 4 + 2] = e[row + 8]!;
			data[base + row * 4 + 3] = e[row + 12]!;
		}
		const fade = volume.edgeFade.map((d) => Math.max(d, 1));
		data[base + 12] = size.x / fade[0]!;
		data[base + 13] = size.y / fade[1]!;
		data[base + 14] = size.z / fade[2]!;
		data.set(volume.atlasSize, base + 16);
		data.set(volume.atlasOffset, base + 20);
	});
	const texture = new THREE.DataTexture(
		data,
		Math.max(1, count) * 6,
		1,
		THREE.RGBAFormat,
		THREE.FloatType
	);
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.needsUpdate = true;
	return texture;
}

function normalizeMatrix(origin: Vec3, angles: Vec3, min: Vec3, max: Vec3): THREE.Matrix4 {
	const toWorld = anglesToMatrix(angles).setPosition(...origin);
	const size = new THREE.Vector3(...max).sub(new THREE.Vector3(...min));
	return new THREE.Matrix4()
		.makeScale(1 / size.x, 1 / size.y, 1 / size.z)
		.multiply(new THREE.Matrix4().makeTranslation(-min[0], -min[1], -min[2]))
		.multiply(toWorld.invert());
}

function envTable(volumes: PackEnvMapVolume[]): THREE.DataTexture {
	const count = Math.min(volumes.length, MAX_ENV_VOLUMES);
	const width = Math.max(1, count) * ENV_VOLUME_TEXELS;
	const data = new Float32Array(width * 4);
	volumes.slice(0, count).forEach((volume, i) => {
		const e = normalizeMatrix(volume.origin, volume.angles, volume.min, volume.max).elements;
		const base = i * ENV_VOLUME_TEXELS * 4;
		for (let row = 0; row < 3; row++) {
			data.set([e[row]!, e[row + 4]!, e[row + 8]!, e[row + 12]!], base + row * 4);
		}
		const size = volume.max.map((v, axis) => v - volume.min[axis]!);
		data.set([...volume.min, volume.arrayIndex], base + 12);
		data.set([...size, volume.box ? 1 : 0], base + 16);
		data.set(
			size.map((s, axis) => s / Math.max(volume.edgeFade[axis]!, 1e-3)),
			base + 20
		);
		data.set(volume.normalization, base + 24);
	});
	const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.FloatType);
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.needsUpdate = true;
	return texture;
}

const emptyArray = (() => {
	const texture = new THREE.DataArrayTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, 1);
	texture.needsUpdate = true;
	return texture;
})();

export interface WorldShadingSetup {
	shading: WorldShading;
	lightmapUniforms: {
		irradiance: THREE.IUniform;
		directional: THREE.IUniform;
		shadows: THREE.IUniform;
	};
	probeUniforms: { irradiance: THREE.IUniform; shadows: THREE.IUniform };
	envUniforms: { texture: THREE.IUniform; mips: THREE.IUniform };
	dispose(): void;
}

export function createWorldShading(
	manifest: MapPackManifest,
	world: PackWorld,
	shared: Record<string, THREE.IUniform>
): WorldShadingSetup {
	const defines: Record<string, string | number> = {};
	const sun = world.sun ?? manifest.worlds[0]?.sun ?? null;
	const ambient = manifest.ambient;
	const sky = ambient
		? new THREE.Vector3(...ambient.skyColor).multiplyScalar(ambient.skyIntensity)
		: new THREE.Vector3(0.3, 0.3, 0.3);

	const lightmapUniforms = {
		irradiance: { value: defaultTextures.black as THREE.Texture },
		directional: { value: defaultTextures.grey as THREE.Texture },
		shadows: { value: defaultTextures.black as THREE.Texture }
	};
	if (world.lightmaps) defines.WORLD_LIGHTMAP = 1;

	const probeUniforms = {
		irradiance: { value: emptyArray as THREE.Texture },
		shadows: { value: emptyArray as THREE.Texture }
	};
	let table: THREE.DataTexture | null = null;
	if (world.probes?.volumes.length) {
		defines.WORLD_PROBES = 1;
		if (world.probes.shadows) defines.WORLD_PROBE_SHADOWS = 1;
		table = probeTable(world.probes.volumes);
	}
	const probeDepth = (() => {
		const ref = world.probes ? manifest.textures[world.probes.irradiance] : undefined;
		const shadowRef = world.probes?.shadows ? manifest.textures[world.probes.shadows] : undefined;
		if (shadowRef) return shadowRef.depth;
		return ref ? ref.depth / 6 : 1;
	})();

	const envUniforms = {
		texture: { value: emptyArray as THREE.Texture },
		mips: { value: 0 }
	};
	let envVolumes: THREE.DataTexture | null = null;
	if (world.envMaps?.volumes.length) {
		defines.WORLD_ENV_MAP = 1;
		envVolumes = envTable(world.envMaps.volumes);
	}

	if (manifest.fog?.cubemap && manifest.sky) defines.FOG_CUBE = 1;
	if (manifest.fog?.gradient) defines.FOG_GRADIENT = 1;

	const mask = new THREE.Vector4();
	if (sun && sun.shadowChannel >= 0 && sun.shadowChannel < 4)
		mask.setComponent(sun.shadowChannel, 1);
	const scale = world.skyCamera?.scale ?? 1;
	const origin = world.skyCamera?.origin ?? [0, 0, 0];

	const uniforms: Record<string, THREE.IUniform> = {
		...shared,
		uSunDir: { value: new THREE.Vector3(...(sun?.toSun ?? [0, 0, 1])).normalize() },
		uSunColor: { value: new THREE.Vector3(...(sun?.color ?? [0, 0, 0])) },
		uSunShadowMask: { value: mask },
		uSunSpecular: { value: sun?.specular === false ? 0 : 1 },
		uAmbientSky: { value: sky.clone().multiplyScalar(0.5) },
		uAmbientGround: { value: sky.clone().multiplyScalar(0.15) },
		uIrradiance: lightmapUniforms.irradiance,
		uDirectional: lightmapUniforms.directional,
		uShadows: lightmapUniforms.shadows,
		uProbeIrradiance: probeUniforms.irradiance,
		uProbeShadows: probeUniforms.shadows,
		uProbeVolumes: { value: table ?? defaultTextures.black },
		uProbeCount: { value: Math.min(world.probes?.volumes.length ?? 0, MAX_PROBE_VOLUMES) },
		uProbeDepth: { value: probeDepth },
		uEnvMap: envUniforms.texture,
		uEnvMips: envUniforms.mips,
		uEnvVolumes: { value: envVolumes ?? defaultTextures.black },
		uEnvCount: { value: Math.min(world.envMaps?.volumes.length ?? 0, MAX_ENV_VOLUMES) },
		uSkyOrigin: { value: new THREE.Vector3(...origin) },
		uWorldScale: { value: scale },
		uCutZ: world.kind === 'world' ? shared.uCutZ! : { value: 1e9 }
	};

	return {
		shading: { uniforms, defines },
		lightmapUniforms,
		probeUniforms,
		envUniforms,
		dispose: () => {
			table?.dispose();
			envVolumes?.dispose();
		}
	};
}

export function fogUniforms(
	manifest: MapPackManifest,
	skyMips: number
): Record<string, THREE.IUniform> {
	const uniforms: Record<string, THREE.IUniform> = {
		uFogCube: { value: null },
		uFogDistance: { value: new THREE.Vector4() },
		uFogHeight: { value: new THREE.Vector4(1, 0.000001, 0, 0) },
		uFogMisc: { value: new THREE.Vector4(1e12, 1e12, 1, 0) },
		uFogRotation: { value: new THREE.Matrix3() },
		uGradientBiasScale: { value: new THREE.Vector4() },
		uGradientExponents: { value: new THREE.Vector2(1, 1) },
		uGradientColor: { value: new THREE.Vector4() },
		uGradientCull: { value: new THREE.Vector2(1e12, 1e12) }
	};

	const cube = manifest.fog?.cubemap;
	if (cube) {
		const scale = 1 / Math.max(1e-3, cube.end - cube.start);
		uniforms.uFogDistance!.value = new THREE.Vector4(
			-cube.start * scale,
			scale,
			cube.lodBias,
			cube.falloffExponent
		);
		const useHeight = cube.useHeight && cube.heightEnd - cube.heightStart > 0;
		if (useHeight) {
			const heightScale = 1 / (cube.heightStart - cube.heightEnd);
			uniforms.uFogHeight!.value = new THREE.Vector4(
				1 - cube.heightStart * heightScale,
				heightScale,
				cube.heightExponent,
				Math.min(7, skyMips)
			);
		} else {
			uniforms.uFogHeight!.value = new THREE.Vector4(1, 0.000001, 0, Math.min(7, skyMips));
		}
		uniforms.uFogMisc!.value = new THREE.Vector4(
			cube.start * cube.start,
			useHeight ? cube.heightStart : 1e12,
			2 ** cube.exposureBias,
			cube.maxOpacity
		);
		uniforms.uFogRotation!.value = new THREE.Matrix3()
			.setFromMatrix4(anglesToMatrix(cube.angles))
			.transpose();
	}

	const gradient = manifest.fog?.gradient;
	if (gradient) {
		const distScale = 1 / Math.max(1e-3, gradient.end - gradient.start);
		const heightScale = 1 / (gradient.heightStart - gradient.heightEnd || -1e-3);
		uniforms.uGradientBiasScale!.value = new THREE.Vector4(
			-gradient.start * distScale,
			-gradient.heightEnd * heightScale,
			distScale,
			heightScale
		);
		uniforms.uGradientExponents!.value = new THREE.Vector2(
			gradient.falloffExponent,
			gradient.heightExponent
		);
		uniforms.uGradientColor!.value = new THREE.Vector4(
			gradient.color[0] * gradient.strength,
			gradient.color[1] * gradient.strength,
			gradient.color[2] * gradient.strength,
			gradient.maxOpacity
		);
		uniforms.uGradientCull!.value = new THREE.Vector2(
			gradient.start * gradient.start,
			gradient.heightStart
		);
	}
	return uniforms;
}
