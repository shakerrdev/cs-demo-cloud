import * as THREE from 'three';
import {
	TEXTURE_CLAMP_S,
	TEXTURE_CLAMP_T,
	TEXTURE_VOLUME,
	decodePackTexture,
	mipSize,
	type PackTexture,
	type TextureFormat
} from '@cs-demo-cloud/replay';

export interface TextureSupport {
	s3tc: boolean;
	s3tcSrgb: boolean;
	rgtc: boolean;
	bptc: boolean;
	anisotropy: number;
	maxArrayLayers: number;
}

export function textureSupport(renderer: THREE.WebGLRenderer): TextureSupport {
	const gl = renderer.getContext() as WebGL2RenderingContext;
	return {
		s3tc: renderer.extensions.has('WEBGL_compressed_texture_s3tc'),
		s3tcSrgb: renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb'),
		rgtc: renderer.extensions.has('EXT_texture_compression_rgtc'),
		bptc: renderer.extensions.has('EXT_texture_compression_bptc'),
		anisotropy: renderer.capabilities.getMaxAnisotropy(),
		maxArrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number
	};
}

export function supportsFormat(support: TextureSupport, format: TextureFormat): boolean {
	switch (format) {
		case 'bc1':
		case 'bc3':
			return support.s3tc;
		case 'bc4':
		case 'bc5':
			return support.rgtc;
		case 'bc6h':
		case 'bc7':
			return support.bptc;
		default:
			return true;
	}
}

const compressedFormats: Partial<Record<TextureFormat, THREE.CompressedPixelFormat>> = {
	bc1: THREE.RGB_S3TC_DXT1_Format,
	bc3: THREE.RGBA_S3TC_DXT5_Format,
	bc4: THREE.RED_RGTC1_Format,
	bc5: THREE.RED_GREEN_RGTC2_Format,
	bc6h: THREE.RGB_BPTC_UNSIGNED_Format,
	bc7: THREE.RGBA_BPTC_Format
};

export interface TextureOptions {
	srgb?: boolean;
	filter?: 'trilinear' | 'linear' | 'nearest';
	anisotropy?: number;
	clamp?: boolean;
	array?: boolean;
}

type TypedView = Uint8Array | Uint16Array;

function uncompressedLayout(format: TextureFormat): {
	format: THREE.PixelFormat;
	type: THREE.TextureDataType;
	view: (data: Uint8Array) => TypedView;
} {
	switch (format) {
		case 'rgba16f':
			return {
				format: THREE.RGBAFormat,
				type: THREE.HalfFloatType,
				view: (data) => new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2)
			};
		case 'r8':
			return { format: THREE.RedFormat, type: THREE.UnsignedByteType, view: (data) => data };
		default:
			return { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, view: (data) => data };
	}
}

function copy(data: Uint8Array): Uint8Array {
	return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice();
}

export function createTexture(packed: PackTexture, options: TextureOptions = {}): THREE.Texture {
	const compressed = compressedFormats[packed.format];
	const volume = (packed.flags & TEXTURE_VOLUME) !== 0;
	const cubeArray = packed.faces === 6 && (packed.depth > 1 || options.array === true);
	let texture: THREE.Texture;

	if (packed.faces === 6 && !cubeArray) {
		const faceMips = Array.from({ length: 6 }, () => [] as THREE.CompressedTexture['mipmaps']);
		packed.mipData.forEach((mip, level) => {
			const faceBytes = mip.length / 6;
			for (let face = 0; face < 6; face++) {
				faceMips[face]!.push({
					data: copy(mip.subarray(face * faceBytes, (face + 1) * faceBytes)),
					width: mipSize(packed.width, level),
					height: mipSize(packed.height, level)
				});
			}
		});
		if (compressed) {
			const images = faceMips.map((mipmaps) => ({
				width: packed.width,
				height: packed.height,
				mipmaps
			})) as unknown as THREE.CompressedTexture[];
			texture = new THREE.CompressedCubeTexture(images, compressed);
		} else {
			const layout = uncompressedLayout(packed.format);
			const faces = faceMips.map(
				(mipmaps) =>
					new THREE.DataTexture(
						layout.view(mipmaps![0]!.data as Uint8Array),
						packed.width,
						packed.height,
						layout.format,
						layout.type
					)
			);
			const cube = new THREE.CubeTexture(faces as unknown as HTMLImageElement[]);
			cube.format = layout.format;
			cube.type = layout.type;
			cube.generateMipmaps = false;
			texture = cube;
		}
	} else if (cubeArray || packed.depth > 1 || options.array) {
		const layers = packed.depth * packed.faces;
		if (compressed) {
			const level0 = packed.mipData[0]!;
			const mipmaps = (volume ? [level0] : packed.mipData).map((data, level) => ({
				data: copy(data),
				width: mipSize(packed.width, level),
				height: mipSize(packed.height, level),
				depth: layers
			}));
			texture = new THREE.CompressedArrayTexture(
				mipmaps as unknown as THREE.CompressedTexture['mipmaps'],
				packed.width,
				packed.height,
				layers,
				compressed
			);
		} else {
			const layout = uncompressedLayout(packed.format);
			const data = layout.view(copy(packed.mipData[0]!));
			const created = volume
				? new THREE.Data3DTexture(data as Uint8Array, packed.width, packed.height, packed.depth)
				: new THREE.DataArrayTexture(data as Uint8Array, packed.width, packed.height, layers);
			created.format = layout.format;
			created.type = layout.type;
			texture = created;
		}
	} else if (compressed) {
		const mipmaps = packed.mipData.map((data, level) => ({
			data: copy(data),
			width: mipSize(packed.width, level),
			height: mipSize(packed.height, level)
		}));
		texture = new THREE.CompressedTexture(mipmaps, packed.width, packed.height, compressed);
	} else {
		const layout = uncompressedLayout(packed.format);
		const data = new THREE.DataTexture(
			layout.view(copy(packed.mipData[0]!)),
			packed.width,
			packed.height,
			layout.format,
			layout.type
		);
		if (packed.mips > 1) {
			data.mipmaps = packed.mipData.map((mip, level) => ({
				data: layout.view(copy(mip)),
				width: mipSize(packed.width, level),
				height: mipSize(packed.height, level)
			})) as unknown as THREE.DataTexture['mipmaps'];
		}
		texture = data;
	}

	const hasMips = packed.mips > 1 && !volume;
	const filter = options.filter ?? 'trilinear';
	texture.magFilter = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
	texture.minFilter =
		filter === 'nearest'
			? THREE.NearestFilter
			: filter === 'trilinear' && hasMips
				? THREE.LinearMipmapLinearFilter
				: THREE.LinearFilter;
	texture.generateMipmaps = false;
	const clampS = options.clamp || (packed.flags & TEXTURE_CLAMP_S) !== 0 || packed.faces === 6;
	const clampT = options.clamp || (packed.flags & TEXTURE_CLAMP_T) !== 0 || packed.faces === 6;
	texture.wrapS = clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
	texture.wrapT = clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
	if (volume) (texture as THREE.Data3DTexture).wrapR = THREE.ClampToEdgeWrapping;
	texture.anisotropy = options.anisotropy ?? 1;
	texture.flipY = false;
	texture.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	texture.needsUpdate = true;
	return texture;
}

export async function fetchPackTexture(url: string, signal?: AbortSignal): Promise<PackTexture> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return decodePackTexture(await response.arrayBuffer());
}
