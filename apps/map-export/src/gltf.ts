export interface GltfAccessor {
	bufferView?: number;
	byteOffset?: number;
	componentType: number;
	count: number;
	type: string;
	normalized?: boolean;
	min?: number[];
	max?: number[];
}

export interface GltfPrimitive {
	attributes: Record<string, number>;
	indices?: number;
	material?: number;
	mode?: number;
}

export interface GltfMaterial {
	name?: string;
	alphaMode?: string;
	alphaCutoff?: number;
	doubleSided?: boolean;
	pbrMetallicRoughness?: { baseColorFactor?: number[] };
	extras?: { vmat?: Vmat; [key: string]: unknown };
	[key: string]: unknown;
}

export interface Vmat {
	Name: string;
	ShaderName: string;
	IntParams: Record<string, number>;
	FloatParams: Record<string, number>;
	VectorParams: Record<string, number[]>;
	TextureParams: Record<string, string>;
}

export interface Gltf {
	nodes?: { mesh?: number; extensions?: Record<string, unknown>; [key: string]: unknown }[];
	meshes?: { name?: string; primitives: GltfPrimitive[]; [key: string]: unknown }[];
	materials?: GltfMaterial[];
	accessors: GltfAccessor[];
	bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
	textures?: unknown[];
	images?: unknown[];
	samplers?: unknown[];
	extensionsUsed?: string[];
	extensionsRequired?: string[];
	extensions?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface VertexLayout {
	lightmap: number | null;
	uv2: number | null;
	paint: number | null;
	blend: number | null;
}

export interface ProcessResult {
	textures: Set<string>;
	materials: number;
	primitives: number;
	dropped: number;
	lightmapped: number;
}

const FLOAT = 5126;

const LIGHTMAPPED_SHADERS = new Set([
	'csgo_lightmappedgeneric.vfx',
	'csgo_vertexlitgeneric.vfx',
	'csgo_environment.vfx',
	'csgo_environment_blend.vfx',
	'csgo_complex.vfx',
	'csgo_simple.vfx',
	'csgo_simple_2way_blend.vfx',
	'csgo_foliage.vfx',
	'csgo_static_overlay.vfx',
	'csgo_glass.vfx',
	'csgo_lightmapped_4wayblend.vfx'
]);

export function isDroppedMaterial(vmat: Vmat | undefined): boolean {
	if (!vmat) return false;
	return vmat.Name.startsWith('materials/tools/') || vmat.ShaderName === 'tools_sprite.vfx';
}

function texcoordIndex(key: string): number {
	return Number(/^TEXCOORD_(\d+)$/.exec(key)?.[1] ?? -1);
}

export function processWorldGltf(
	gltf: Gltf,
	bin: Uint8Array,
	lightmapUvScale: number | null
): ProcessResult {
	const meshes = gltf.meshes ?? [];
	const materials = gltf.materials ?? [];
	const used = new Set<number>();
	for (const mesh of meshes) {
		for (const primitive of mesh.primitives) {
			for (const accessor of Object.values(primitive.attributes)) used.add(accessor);
			if (primitive.indices !== undefined) used.add(primitive.indices);
		}
	}

	const unusedByCount = new Map<number, number[]>();
	gltf.accessors.forEach((accessor, index) => {
		if (used.has(index) || accessor.type !== 'VEC2' || accessor.componentType !== FLOAT) return;
		const list = unusedByCount.get(accessor.count) ?? [];
		list.push(index);
		unusedByCount.set(accessor.count, list);
	});

	const readVec2 = (index: number): Float32Array => {
		const accessor = gltf.accessors[index]!;
		const bufferView = gltf.bufferViews[accessor.bufferView ?? -1];
		if (!bufferView) return new Float32Array(accessor.count * 2);
		const stride = bufferView.byteStride ?? 8;
		const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
		const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
		const out = new Float32Array(accessor.count * 2);
		for (let i = 0; i < accessor.count; i++) {
			out[i * 2] = view.getFloat32(start + i * stride, true);
			out[i * 2 + 1] = view.getFloat32(start + i * stride + 4, true);
		}
		return out;
	};

	const scaledCache = new Map<number, boolean>();
	const isScaledLightmap = (index: number): boolean => {
		const cached = scaledCache.get(index);
		if (cached !== undefined) return cached;
		let result = false;
		const accessor = gltf.accessors[index]!;
		const candidates = unusedByCount.get(accessor.count);
		if (lightmapUvScale && lightmapUvScale !== 1 && candidates && accessor.type === 'VEC2') {
			const values = readVec2(index);
			const step = Math.max(1, Math.floor(values.length / 2 / 64));
			result = candidates.some((candidate) => {
				const original = readVec2(candidate);
				for (let i = 0; i < values.length / 2; i += step) {
					for (const axis of [0, 1]) {
						const expected = original[i * 2 + axis]! * lightmapUvScale;
						if (Math.abs(values[i * 2 + axis]! - expected) > 1e-4 * Math.max(1, Math.abs(expected)))
							return false;
					}
				}
				return true;
			});
		}
		scaledCache.set(index, result);
		return result;
	};

	const variants = new Map<string, number>();
	const newMaterials: GltfMaterial[] = [];
	const textures = new Set<string>();
	let primitives = 0;
	let dropped = 0;
	let lightmapped = 0;

	const materialFor = (original: number | undefined, layout: VertexLayout): number => {
		const key = `${original ?? -1}|${layout.lightmap}|${layout.uv2}|${layout.paint}|${layout.blend}`;
		let index = variants.get(key);
		if (index === undefined) {
			const source = original !== undefined ? materials[original] : undefined;
			const vmat = source?.extras?.vmat;
			for (const path of Object.values(vmat?.TextureParams ?? {})) textures.add(path);
			const material: GltfMaterial = {
				name: source?.name ?? 'default',
				extras: {
					...(vmat ? { vmat } : {}),
					tint: source?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
					layout
				}
			};
			if (source?.alphaMode) material.alphaMode = source.alphaMode;
			if (source?.alphaCutoff !== undefined) material.alphaCutoff = source.alphaCutoff;
			if (source?.doubleSided) material.doubleSided = true;
			index = newMaterials.length;
			newMaterials.push(material);
			variants.set(key, index);
		}
		return index;
	};

	const meshIndex = new Map<number, number>();
	const newMeshes: NonNullable<Gltf['meshes']> = [];

	meshes.forEach((mesh, index) => {
		const kept: GltfPrimitive[] = [];
		for (const primitive of mesh.primitives) {
			const vmat =
				primitive.material !== undefined ? materials[primitive.material]?.extras?.vmat : undefined;
			if (isDroppedMaterial(vmat)) {
				dropped++;
				continue;
			}

			const attributes = primitive.attributes;
			const extraUvs = Object.keys(attributes)
				.map(texcoordIndex)
				.filter((n) => n >= 1)
				.sort((a, b) => a - b);

			let lightmapSource: number | null = null;
			for (const n of extraUvs) {
				if (isScaledLightmap(attributes[`TEXCOORD_${n}`]!)) {
					lightmapSource = n;
					break;
				}
			}
			if (
				lightmapSource === null &&
				lightmapUvScale === 1 &&
				extraUvs.length &&
				vmat &&
				LIGHTMAPPED_SHADERS.has(vmat.ShaderName)
			)
				lightmapSource = extraUvs[extraUvs.length - 1]!;
			const secondarySource = extraUvs.find((n) => n !== lightmapSource) ?? null;

			const next: Record<string, number> = {};
			for (const key of ['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0']) {
				if (attributes[key] !== undefined) next[key] = attributes[key]!;
			}
			const layout: VertexLayout = { lightmap: null, uv2: null, paint: null, blend: null };
			let uv = next.TEXCOORD_0 !== undefined ? 1 : 0;
			if (lightmapSource !== null && uv === 1) {
				next[`TEXCOORD_${uv}`] = attributes[`TEXCOORD_${lightmapSource}`]!;
				layout.lightmap = uv++;
				lightmapped++;
			}
			if (secondarySource !== null && uv >= 1) {
				next[`TEXCOORD_${uv}`] = attributes[`TEXCOORD_${secondarySource}`]!;
				layout.uv2 = uv++;
			}
			let color = 0;
			if (attributes.COLOR_0 !== undefined) {
				next[`COLOR_${color}`] = attributes.COLOR_0;
				layout.paint = color++;
			}
			const blend = attributes._TEXCOORD_4;
			if (blend !== undefined && gltf.accessors[blend]?.type === 'VEC4') {
				next[`COLOR_${color}`] = blend;
				layout.blend = color++;
			}

			kept.push({
				...primitive,
				attributes: next,
				material: materialFor(primitive.material, layout)
			});
			primitives++;
		}
		if (kept.length) {
			meshIndex.set(index, newMeshes.length);
			newMeshes.push({ ...mesh, primitives: kept });
		}
	});

	for (const node of gltf.nodes ?? []) {
		if (node.mesh !== undefined) {
			const mapped = meshIndex.get(node.mesh);
			if (mapped === undefined) delete node.mesh;
			else node.mesh = mapped;
		}
		delete node.extensions;
	}

	gltf.meshes = newMeshes;
	gltf.materials = newMaterials;
	delete gltf.textures;
	delete gltf.images;
	delete gltf.samplers;
	delete gltf.extensions;
	const keepExtensions = (list?: string[]) =>
		list?.filter((name) => name === 'KHR_mesh_quantization');
	gltf.extensionsUsed = keepExtensions(gltf.extensionsUsed);
	gltf.extensionsRequired = keepExtensions(gltf.extensionsRequired);
	if (!gltf.extensionsUsed?.length) delete gltf.extensionsUsed;
	if (!gltf.extensionsRequired?.length) delete gltf.extensionsRequired;

	return { textures, materials: newMaterials.length, primitives, dropped, lightmapped };
}
