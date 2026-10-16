import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	playerClipNames,
	weaponClass,
	weaponKey,
	weaponModelKey,
	weaponPoseName,
	weaponShootName
} from './player-pack.ts';

test('maps demo weapon names to weapon keys', () => {
	assert.equal(weaponKey('AK-47'), 'ak47');
	assert.equal(weaponKey('M4A1-S'), 'm4a1_silencer');
	assert.equal(weaponKey('M4A4'), 'm4a4');
	assert.equal(weaponKey('USP-S'), 'usp_silencer');
	assert.equal(weaponKey('weapon_glock'), 'glock');
	assert.equal(weaponKey('High Explosive Grenade'), 'hegrenade');
	assert.equal(weaponKey('C4 Explosive'), 'c4');
	assert.equal(weaponKey('Zeus x27'), 'taser');
	assert.equal(weaponKey('knife_t'), 'knife');
	assert.equal(weaponKey('Flip Knife'), 'knife_flip');
	assert.equal(weaponKey('M9 Bayonet'), 'knife_m9');
	assert.equal(weaponKey(''), null);
	assert.equal(weaponKey('something new'), null);
});

test('groups weapons into animation classes', () => {
	assert.equal(weaponClass('ak47'), 'rifle');
	assert.equal(weaponClass('awp'), 'rifle');
	assert.equal(weaponClass('deagle'), 'pistol');
	assert.equal(weaponClass('knife_karambit'), 'knife');
	assert.equal(weaponClass('smokegrenade'), 'grenade');
	assert.equal(weaponClass('c4'), 'c4');
	assert.equal(weaponClass(null), 'knife');
});

test('picks models, poses and shots per weapon', () => {
	assert.equal(weaponModelKey('knife', 'CT'), 'knife_default_ct');
	assert.equal(weaponModelKey('knife', 'T'), 'knife_default_t');
	assert.equal(weaponModelKey('ak47', 'T'), 'ak47');
	assert.equal(weaponPoseName('m4a1_silencer'), 'm4a1s');
	assert.equal(weaponPoseName('incgrenade'), 'molotov');
	assert.equal(weaponPoseName('flashbang'), 'grenade');
	assert.equal(weaponPoseName('knife'), null);
	assert.equal(weaponShootName('hkp2000'), 'shoot_hkp');
	assert.equal(weaponShootName('cz75a'), 'shoot_cz75');
	assert.equal(weaponShootName('c4'), null);
});

test('lists every clip the viewer asks for once', () => {
	const clips = playerClipNames();
	assert.equal(new Set(clips).size, clips.length);
	for (const name of ['idle_rifle', 'walk_ne_pistol', 'crouch_sw_knife', 'idle_ak', 'shoot_awp'])
		assert.ok(clips.includes(name), name);
});
