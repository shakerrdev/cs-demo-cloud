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

const COMPONENT_BYTES: Record<number, number> = {
	5120: 1,
	5121: 1,
	5122: 2,
	5123: 2,
	5125: 4,
	5126: 4
};
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const UNSIGNED_INT = 5125;
const UNSIGNED_SHORT = 5123;

function align4(value: number): number {
	return (value + 3) & ~3;
}

class BufferOut {
	private chunks: Uint8Array[] = [];
	length = 0;

	add(bytes: Uint8Array): number {
		const offset = this.length;
		this.chunks.push(bytes);
		this.length += bytes.length;
		const padding = align4(this.length) - this.length;
		if (padding) {
			this.chunks.push(new Uint8Array(padding));
			this.length += padding;
		}
		return offset;
	}

	concat(): Uint8Array {
		const out = new Uint8Array(this.length);
		let offset = 0;
		for (const chunk of this.chunks) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return out;
	}
}

export interface RepackResult {
	bin: Uint8Array;
	compacted: number;
}

export function repackBuffers(gltf: Gltf, bin: Uint8Array): RepackResult {
	const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
	const accessors = gltf.accessors;
	const views = gltf.bufferViews;
	const out = new BufferOut();
	const newAccessors: GltfAccessor[] = [];
	const newViews: Gltf['bufferViews'] = [];
	const copied = new Map<number, number>();
	let compacted = 0;

	const layout = (index: number) => {
		const accessor = accessors[index]!;
		const bufferView = views[accessor.bufferView ?? -1];
		const elementBytes = COMPONENT_BYTES[accessor.componentType]! * TYPE_COMPONENTS[accessor.type]!;
		return {
			accessor,
			bufferView,
			elementBytes,
			stride: bufferView?.byteStride ?? elementBytes,
			start: (bufferView?.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
		};
	};

	const push = (
		source: GltfAccessor,
		bytes: Uint8Array,
		count: number,
		stride: number,
		target: number | undefined,
		bounds?: { min: number[]; max: number[] }
	): number => {
		const byteOffset = out.add(bytes);
		const bufferView: Gltf['bufferViews'][number] & { target?: number } = {
			buffer: 0,
			byteOffset,
			byteLength: bytes.length
		};
		if (target !== undefined) bufferView.target = target;
		if (stride !== COMPONENT_BYTES[source.componentType]! * TYPE_COMPONENTS[source.type]!)
			bufferView.byteStride = stride;
		newViews.push(bufferView);
		const accessor: GltfAccessor = {
			bufferView: newViews.length - 1,
			componentType: source.componentType,
			count,
			type: source.type
		};
		if (source.normalized) accessor.normalized = true;
		if (bounds) {
			accessor.min = bounds.min;
			accessor.max = bounds.max;
		} else if (source.min && source.max) {
			accessor.min = source.min;
			accessor.max = source.max;
		}
		newAccessors.push(accessor);
		return newAccessors.length - 1;
	};

	const copyWhole = (index: number, isIndices: boolean): number => {
		const existing = copied.get(index);
		if (existing !== undefined) return existing;
		const { accessor, elementBytes, stride, start } = layout(index);
		const outStride = isIndices ? elementBytes : align4(elementBytes);
		const bytes = new Uint8Array(accessor.count * outStride);
		for (let i = 0; i < accessor.count; i++)
			bytes.set(bin.subarray(start + i * stride, start + i * stride + elementBytes), i * outStride);
		const created = push(accessor, bytes, accessor.count, outStride, isIndices ? 34963 : 34962);
		copied.set(index, created);
		return created;
	};

	const readIndices = (index: number): Uint32Array => {
		const { accessor, stride, start } = layout(index);
		const indices = new Uint32Array(accessor.count);
		for (let i = 0; i < accessor.count; i++) {
			const at = start + i * stride;
			indices[i] =
				accessor.componentType === UNSIGNED_INT
					? view.getUint32(at, true)
					: accessor.componentType === UNSIGNED_SHORT
						? view.getUint16(at, true)
						: view.getUint8(at);
		}
		return indices;
	};

	for (const mesh of gltf.meshes ?? []) {
		for (const primitive of mesh.primitives) {
			const attributes = Object.entries(primitive.attributes);
			const vertexCount = attributes.length ? accessors[attributes[0]![1]]!.count : 0;
			if (primitive.indices === undefined) {
				for (const [name, index] of attributes)
					primitive.attributes[name] = copyWhole(index, false);
				continue;
			}

			const indices = readIndices(primitive.indices);
			const remap = new Int32Array(vertexCount).fill(-1);
			const used: number[] = [];
			for (const vertex of indices) {
				if (remap[vertex] === -1) {
					remap[vertex] = used.length;
					used.push(vertex);
				}
			}
			if (used.length > vertexCount * 0.75) {
				for (const [name, index] of attributes)
					primitive.attributes[name] = copyWhole(index, false);
				primitive.indices = copyWhole(primitive.indices, true);
				continue;
			}

			compacted++;
			for (const [name, index] of attributes) {
				const { accessor, elementBytes, stride, start } = layout(index);
				const outStride = align4(elementBytes);
				const bytes = new Uint8Array(used.length * outStride);
				used.forEach((vertex, i) =>
					bytes.set(
						bin.subarray(start + vertex * stride, start + vertex * stride + elementBytes),
						i * outStride
					)
				);
				let bounds: { min: number[]; max: number[] } | undefined;
				if (name === 'POSITION' && accessor.componentType === FLOAT && accessor.type === 'VEC3') {
					const floats = new DataView(bytes.buffer);
					const min = [Infinity, Infinity, Infinity];
					const max = [-Infinity, -Infinity, -Infinity];
					for (let i = 0; i < used.length; i++) {
						for (let axis = 0; axis < 3; axis++) {
							const value = floats.getFloat32(i * outStride + axis * 4, true);
							if (value < min[axis]!) min[axis] = value;
							if (value > max[axis]!) max[axis] = value;
						}
					}
					bounds = { min, max };
				}
				primitive.attributes[name] = push(accessor, bytes, used.length, outStride, 34962, bounds);
			}
			const wide = used.length > 0xffff;
			const indexBytes = new Uint8Array(indices.length * (wide ? 4 : 2));
			const indexView = new DataView(indexBytes.buffer);
			indices.forEach((vertex, i) => {
				if (wide) indexView.setUint32(i * 4, remap[vertex]!, true);
				else indexView.setUint16(i * 2, remap[vertex]!, true);
			});
			primitive.indices = push(
				{
					componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT,
					count: indices.length,
					type: 'SCALAR'
				},
				indexBytes,
				indices.length,
				wide ? 4 : 2,
				34963
			);
		}
	}

	const result = out.concat();
	gltf.accessors = newAccessors;
	gltf.bufferViews = newViews;
	gltf.buffers = [{ byteLength: result.length }];
	return { bin: result, compacted };
}

export interface ModelGltfOptions {
	meshes?: (name: string) => boolean;
	animations?: (name: string) => boolean;
	keepMeshes?: boolean;
	skeletonRoot?: string;
	dropSkins?: boolean;
	part?: (mesh: string) => string | null;
	textureParams: Set<string>;
}

export interface ModelResult {
	textures: Set<string>;
	materials: string[];
	clips: string[];
	nodes: Record<string, { translation?: number[]; rotation?: number[] }>;
}

const MODEL_ATTRIBUTES = ['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'];

export function processModelGltf(gltf: Gltf, options: ModelGltfOptions): ModelResult {
	const textures = new Set<string>();
	const nodes = gltf.nodes ?? [];
	const meshes = gltf.meshes ?? [];
	const wanted = (index: number) => {
		const name = meshes[index]?.name;
		return Boolean(name) && (options.meshes?.(name!) ?? true);
	};
	const fallback = !meshes.some((_, index) => wanted(index));
	const keepMesh = (index: number) => options.keepMeshes !== false && (fallback || wanted(index));

	const transforms: ModelResult['nodes'] = {};
	for (const node of nodes) {
		if (typeof node.name === 'string')
			transforms[node.name] = {
				translation: node.translation as number[] | undefined,
				rotation: node.rotation as number[] | undefined
			};
		if (node.mesh !== undefined && !keepMesh(node.mesh)) {
			delete node.mesh;
			delete node.skin;
		}
		if (options.dropSkins) delete node.skin;
		delete node.extensions;
	}
	if (options.dropSkins) delete gltf.skins;

	for (const mesh of meshes) {
		for (const primitive of mesh.primitives) {
			const attributes: Record<string, number> = {};
			for (const key of MODEL_ATTRIBUTES)
				if (
					primitive.attributes[key] !== undefined &&
					!(options.dropSkins && (key === 'JOINTS_0' || key === 'WEIGHTS_0'))
				)
					attributes[key] = primitive.attributes[key]!;
			primitive.attributes = attributes;
		}
	}

	gltf.materials = (gltf.materials ?? []).map((source) => {
		const vmat = source.extras?.vmat;
		if (vmat) {
			vmat.TextureParams = Object.fromEntries(
				Object.entries(vmat.TextureParams).filter(([name]) => options.textureParams.has(name))
			);
			for (const path of Object.values(vmat.TextureParams)) textures.add(path);
		}
		const material: GltfMaterial = {
			name: source.name ?? 'default',
			extras: { ...(vmat ? { vmat } : {}), tint: source.pbrMetallicRoughness?.baseColorFactor }
		};
		if (source.alphaMode) material.alphaMode = source.alphaMode;
		if (source.alphaCutoff !== undefined) material.alphaCutoff = source.alphaCutoff;
		if (source.doubleSided) material.doubleSided = true;
		return material;
	});

	if (options.part) {
		const parts = new Map<string, number>();
		for (const mesh of meshes) {
			const part = mesh.name ? options.part(mesh.name) : null;
			if (!part) continue;
			for (const primitive of mesh.primitives) {
				if (primitive.material === undefined) continue;
				const key = `${primitive.material}|${part}`;
				let index = parts.get(key);
				if (index === undefined) {
					const source = gltf.materials[primitive.material]!;
					index = gltf.materials.length;
					gltf.materials.push({ ...source, extras: { ...source.extras, part } });
					parts.set(key, index);
				}
				primitive.material = index;
			}
		}
	}

	const skeleton = new Set<number>();
	const rootIndex = options.skeletonRoot
		? nodes.findIndex((node) => node.name === options.skeletonRoot)
		: -1;
	const walk = (index: number) => {
		skeleton.add(index);
		for (const child of (nodes[index]?.children as number[] | undefined) ?? []) walk(child);
	};
	if (rootIndex >= 0) walk(rootIndex);

	const scenes = (gltf.scenes as { nodes?: number[] }[] | undefined) ?? [];
	if (rootIndex >= 0)
		for (const scene of scenes)
			scene.nodes = scene.nodes?.filter(
				(index) => nodes[index]?.mesh !== undefined || containsNode(nodes, index, rootIndex)
			);

	const animations =
		(gltf.animations as
			| { name?: string; channels: { target: { node?: number } }[]; samplers: unknown[] }[]
			| undefined) ?? [];
	const kept = animations.filter((animation) => {
		const name = animation.name ?? '';
		return options.animations ? options.animations(name) : false;
	});
	if (rootIndex >= 0)
		for (const animation of kept) {
			const channels = animation.channels.filter(
				(channel) => channel.target.node !== undefined && skeleton.has(channel.target.node)
			) as { sampler: number; target: { node?: number } }[];
			const samplers: unknown[] = [];
			const remap = new Map<number, number>();
			for (const channel of channels) {
				let index = remap.get(channel.sampler);
				if (index === undefined) {
					index = samplers.length;
					samplers.push(animation.samplers[channel.sampler]);
					remap.set(channel.sampler, index);
				}
				channel.sampler = index;
			}
			animation.channels = channels;
			animation.samplers = samplers;
		}
	const seen = new Set<string>();
	gltf.animations = kept.filter((animation) => {
		const short = (animation.name ?? '').split('/').pop()!;
		if (seen.has(short)) return false;
		seen.add(short);
		animation.name = short;
		return true;
	});
	if (!(gltf.animations as unknown[]).length) delete gltf.animations;

	delete gltf.textures;
	delete gltf.images;
	delete gltf.samplers;
	delete gltf.extensions;
	delete gltf.extensionsUsed;
	delete gltf.extensionsRequired;
	const materials = (gltf.materials ?? []).flatMap((material) =>
		material.extras?.vmat ? [material.extras.vmat.Name] : []
	);
	return { textures, materials: [...new Set(materials)], clips: [...seen], nodes: transforms };
}

function containsNode(nodes: NonNullable<Gltf['nodes']>, index: number, target: number): boolean {
	if (index === target) return true;
	return ((nodes[index]?.children as number[] | undefined) ?? []).some((child) =>
		containsNode(nodes, child, target)
	);
}
