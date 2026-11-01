import * as THREE from 'three';

export interface SunShadow {
	target: THREE.WebGLRenderTarget;
	matrix: THREE.Matrix4;
	texel: number;
	range: number;
	dispose(): void;
}

export function bakeSunShadow(
	renderer: THREE.WebGLRenderer,
	object: THREE.Mesh,
	direction: THREE.Vector3,
	size = 4096
): SunShadow {
	const box = new THREE.Box3().setFromObject(object);
	const center = box.getCenter(new THREE.Vector3());
	const radius = box.getSize(new THREE.Vector3()).length() / 2;

	const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, radius * 4);
	camera.up.set(0, 0, 1);
	if (Math.abs(direction.z) > 0.99) camera.up.set(0, 1, 0);
	camera.position.copy(center).addScaledVector(direction.clone().normalize(), radius * 2);
	camera.lookAt(center);
	camera.updateMatrixWorld();
	camera.updateProjectionMatrix();

	const target = new THREE.WebGLRenderTarget(size, size, {
		depthBuffer: true,
		depthTexture: new THREE.DepthTexture(size, size, THREE.UnsignedIntType)
	});
	target.depthTexture!.minFilter = THREE.NearestFilter;
	target.depthTexture!.magFilter = THREE.NearestFilter;

	const material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
	const scene = new THREE.Scene();
	const caster = new THREE.Mesh(object.geometry, material);
	caster.matrixAutoUpdate = false;
	caster.matrix.copy(object.matrixWorld);
	caster.matrixWorld.copy(object.matrixWorld);
	caster.frustumCulled = false;
	scene.add(caster);

	const previous = renderer.getRenderTarget();
	renderer.setRenderTarget(target);
	renderer.clear();
	renderer.render(scene, camera);
	renderer.setRenderTarget(previous);
	material.dispose();

	const matrix = new THREE.Matrix4()
		.makeTranslation(0.5, 0.5, 0.5)
		.multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5))
		.multiply(camera.projectionMatrix)
		.multiply(camera.matrixWorldInverse);

	return {
		target,
		matrix,
		texel: (radius * 2) / size,
		range: camera.far - camera.near,
		dispose: () => target.dispose()
	};
}
