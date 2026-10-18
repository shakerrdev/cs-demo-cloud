import * as THREE from 'three';

const LIGHTING_DEFINES = [
	'PROBES',
	'PROBE_SHADOWS',
	'ENV_MAP',
	'SPECULAR_INDIRECT',
	'FOG_CUBE',
	'FOG_GRADIENT',
	'LIGHTMAP',
	'LIGHTMAP_ATTR'
];
const SURFACE_DEFINES = [
	'SKIN_PAINT',
	'SKIN_PAINT_NORMAL',
	'GLOVE_PAINT',
	'TINT_MASK',
	'TINT_UV',
	'METAL_TEXTURE',
	'METAL_IN_ALPHA',
	'AO_TEXTURE',
	'AO_UV',
	'NORMAL_MAP',
	'VERTEX_AO',
	'SELF_ILLUM'
];

interface Job {
	bake: THREE.ShaderMaterial;
	targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
	signature: string;
}

export function needsBake(material: THREE.ShaderMaterial): boolean {
	return material.defines.SKIN_PAINT !== undefined || material.defines.GLOVE_PAINT !== undefined;
}

export class PaintBaker {
	private jobs = new Map<THREE.ShaderMaterial, Job>();
	private scene = new THREE.Scene();
	private camera = new THREE.Camera();
	private quad: THREE.Mesh;
	private size: number;

	constructor(size = 1024) {
		this.size = size;
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
		this.quad.frustumCulled = false;
		this.scene.add(this.quad);
	}

	add(source: THREE.ShaderMaterial): THREE.ShaderMaterial {
		const defines = { ...source.defines };
		for (const name of LIGHTING_DEFINES) delete defines[name];
		const glove = defines.GLOVE_PAINT !== undefined;
		if (glove) {
			for (const name of ['NORMAL_MAP', 'METAL_TEXTURE', 'METAL_IN_ALPHA', 'TINT_MASK', 'TINT_UV'])
				delete defines[name];
			defines.ROUGHNESS = '0.5';
			defines.DETAIL = 0;
		}
		const bake = new THREE.ShaderMaterial({
			name: `${source.name} (bake)`,
			glslVersion: source.glslVersion,
			vertexShader: source.vertexShader,
			fragmentShader: source.fragmentShader,
			uniforms: { ...source.uniforms, uBakePass: { value: 0 } },
			defines: { ...defines, BAKE: 1 },
			depthTest: false,
			depthWrite: false
		});
		source.dispose();

		const target = () =>
			new THREE.WebGLRenderTarget(this.size, this.size, {
				depthBuffer: false,
				generateMipmaps: true,
				minFilter: THREE.LinearMipmapLinearFilter,
				magFilter: THREE.LinearFilter,
				wrapS: THREE.RepeatWrapping,
				wrapT: THREE.RepeatWrapping,
				anisotropy: 4
			});
		const targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [target(), target()];

		const shown = { ...source.defines };
		for (const name of SURFACE_DEFINES) delete shown[name];
		shown.BAKED = 1;
		shown.NO_TINT = 1;
		shown.DETAIL = 0;
		shown.ROUGHNESS = '0.5';
		const display = new THREE.ShaderMaterial({
			name: source.name,
			glslVersion: source.glslVersion,
			vertexShader: source.vertexShader,
			fragmentShader: source.fragmentShader,
			uniforms: {
				...source.uniforms,
				uBakedA: { value: targets[0].texture },
				uBakedB: { value: targets[1].texture }
			},
			defines: shown,
			side: source.side,
			transparent: source.transparent,
			depthWrite: source.depthWrite,
			alphaToCoverage: source.alphaToCoverage,
			blending: source.blending,
			polygonOffset: source.polygonOffset,
			polygonOffsetFactor: source.polygonOffsetFactor,
			polygonOffsetUnits: source.polygonOffsetUnits
		});
		this.jobs.set(display, { bake, targets, signature: '' });
		return display;
	}

	remove(display: THREE.ShaderMaterial) {
		const job = this.jobs.get(display);
		if (!job) return;
		job.bake.dispose();
		for (const target of job.targets) target.dispose();
		this.jobs.delete(display);
	}

	clear() {
		for (const display of [...this.jobs.keys()]) this.remove(display);
	}

	update(renderer: THREE.WebGLRenderer, budget = 2): { baked: number; pending: boolean } {
		let baked = 0;
		let pending = false;
		for (const job of this.jobs.values()) {
			const signature = this.signature(job.bake);
			if (signature === job.signature) continue;
			if (baked >= budget) {
				pending = true;
				break;
			}
			this.render(renderer, job);
			job.signature = signature;
			baked++;
		}
		return { baked, pending };
	}

	private signature(material: THREE.ShaderMaterial): string {
		let out = '';
		for (const uniform of Object.values(material.uniforms)) {
			const value = uniform.value as THREE.Texture | undefined;
			if (value?.isTexture) out += `${value.id}:${value.version};`;
		}
		return out;
	}

	private render(renderer: THREE.WebGLRenderer, job: Job) {
		const previous = renderer.getRenderTarget();
		const autoClear = renderer.autoClear;
		renderer.autoClear = true;
		this.quad.material = job.bake;
		job.targets.forEach((target, pass) => {
			job.bake.uniforms.uBakePass!.value = pass;
			renderer.setRenderTarget(target);
			renderer.render(this.scene, this.camera);
		});
		renderer.setRenderTarget(previous);
		renderer.autoClear = autoClear;
	}

	dispose() {
		this.clear();
		this.quad.geometry.dispose();
	}
}
