import * as THREE from 'three';

const vertex = /* glsl */ `
invariant gl_Position;
out float vZ;
void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vZ = world.z;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = /* glsl */ `
precision highp float;
uniform float uCutZ;
in float vZ;
void main() {
	if (vZ > uCutZ) discard;
}
`;

export class DepthPrepass {
	private opaque: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
	private others: THREE.Object3D[] = [];
	private materials = new Map<THREE.Side, THREE.ShaderMaterial>();
	private group: THREE.Object3D;
	private uniforms: Record<string, THREE.IUniform>;

	constructor(group: THREE.Object3D, shared: Record<string, THREE.IUniform>) {
		this.group = group;
		this.uniforms = { uCutZ: shared.uCutZ! };
		group.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh) return;
			const material = mesh.material as THREE.ShaderMaterial;
			const opaque =
				!Array.isArray(mesh.material) &&
				!material.transparent &&
				material.colorWrite !== false &&
				material.depthWrite !== false &&
				!material.alphaToCoverage &&
				!material.defines?.ALPHA_TEST;
			if (opaque) this.opaque.push({ mesh, material: mesh.material });
			else this.others.push(mesh);
		});
	}

	get size(): number {
		return this.opaque.length;
	}

	private material(side: THREE.Side): THREE.ShaderMaterial {
		let material = this.materials.get(side);
		if (!material) {
			material = new THREE.ShaderMaterial({
				glslVersion: THREE.GLSL3,
				vertexShader: vertex,
				fragmentShader: fragment,
				uniforms: this.uniforms,
				side,
				colorWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: 1,
				polygonOffsetUnits: 1
			});
			this.materials.set(side, material);
		}
		return material;
	}

	render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
		if (!this.opaque.length) return;
		const hidden: THREE.Object3D[] = [];
		for (const object of this.others) {
			if (object.visible) {
				object.visible = false;
				hidden.push(object);
			}
		}
		for (const entry of this.opaque) {
			entry.material = entry.mesh.material;
			entry.mesh.material = this.material((entry.material as THREE.Material).side);
		}
		renderer.render(this.group, camera);
		for (const entry of this.opaque) entry.mesh.material = entry.material;
		for (const object of hidden) object.visible = true;
	}

	dispose() {
		for (const material of this.materials.values()) material.dispose();
	}
}
