import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectSoundEvents, monoWav, resolveSoundEvent } from './sounds.ts';

test('resolves sound events with bases and child events', () => {
	const events = collectSoundEvents([
		{
			'Base.Footstep': {
				volume: 0.5,
				distance_volume_mapping_curve: [
					[0, 1, 0, 0, 1, 1],
					[1000, 0, 0, 0, 1, 1]
				],
				vsnd_files_track_01: ['sounds/step_01.vsnd', 'sounds/step_02.vsnd']
			},
			'CT_Concrete.StepLeft': { base: 'Base.Footstep', volume: 0.9, soundevent_01: '' },
			'Weapon_X.Single': { soundevent_01: 'Weapon_X.Layer', pitch: 1.1 },
			'Weapon_X.Layer': { vsnd_files_track_01: 'sounds/x.vsnd' }
		}
	]);
	assert.deepEqual(resolveSoundEvent(events, 'ct_concrete.stepleft'), {
		files: ['sounds/step_01.vsnd', 'sounds/step_02.vsnd'],
		volume: 0.9,
		pitch: 1,
		curve: [0, 1, 1000, 0]
	});
	assert.deepEqual(resolveSoundEvent(events, 'Weapon_X.Single')?.files, ['sounds/x.vsnd']);
	assert.equal(resolveSoundEvent(events, 'Missing.Event'), null);
});

function wav(channels: number, samples: number[]): Uint8Array {
	const out = new Uint8Array(44 + samples.length * 2);
	const view = new DataView(out.buffer);
	const text = (offset: number, value: string) =>
		[...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
	text(0, 'RIFF');
	view.setUint32(4, out.length - 8, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, 44100, true);
	view.setUint16(34, 16, true);
	text(36, 'data');
	view.setUint32(40, samples.length * 2, true);
	samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
	return out;
}

test('mixes stereo wav files down to mono', () => {
	const mono = monoWav(wav(2, [100, 300, -200, -400]));
	const view = new DataView(mono.buffer);
	assert.equal(view.getUint16(22, true), 1);
	assert.equal(view.getUint32(24, true), 44100);
	assert.equal(view.getUint32(40, true), 4);
	assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true)], [200, -300]);
});
