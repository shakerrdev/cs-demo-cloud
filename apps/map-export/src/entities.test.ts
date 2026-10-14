import assert from 'node:assert/strict';
import { test } from 'node:test';
import { className, number, parseEntities, text, vec3 } from './entities.ts';

test('reads entities decompiled by Source 2 Viewer', () => {
	const [sun, sky] = parseEntities(`====0====
classname light_environment
angles 50 223 0
color "255 200 150"
brightness 2.5
startdisabled false
====1====
classname env_sky
skyname "[PR#]materials\\\\skybox\\\\sky.vmat"
`);
	assert.equal(className(sun!), 'light_environment');
	assert.deepEqual(vec3(sun!, 'angles', [0, 0, 0]), [50, 223, 0]);
	assert.deepEqual(vec3(sun!, 'color', [255, 255, 255]), [255, 200, 150]);
	assert.equal(number(sun!, 'brightness', 1), 2.5);
	assert.equal(number(sun!, 'startdisabled', 1), 0);
	assert.equal(number(sun!, 'missing', 7), 7);
	assert.equal(text(sky!, 'skyname'), 'materials/skybox/sky.vmat');
});
