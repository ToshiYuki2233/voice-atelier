import test from 'node:test';
import assert from 'node:assert/strict';
import { measureLevel, estimatePitch, PitchReadout } from '../public/analysis.js';
function sine(hz, rate, amplitude = 0.2, harmonics = false) {
  return Float32Array.from({ length: 4096 }, (_, i) => amplitude * (Math.sin(2 * Math.PI * hz * i / rate) + (harmonics ? 0.5 * Math.sin(4 * Math.PI * hz * i / rate) : 0)));
}
test('RMS uses actual sample energy; zero and invalid input have no value', () => {
  assert.equal(measureLevel(new Float32Array(4096)).dbfs, null);
  assert.equal(measureLevel(new Float32Array([NaN])).dbfs, null);
  const result = measureLevel(new Float32Array([0.5, -0.5]));
  assert.ok(Math.abs(result.dbfs - (-6.020599913)) < 1e-6);
  assert.equal(result.peak, 0.5);
});
test('pitch follows synthetic periodic input across audio rates and voice frequencies', () => {
  for (const rate of [16000, 44100, 48000, 96000]) {
    for (const hz of [65, 110, 220, 440, 880]) {
      for (const harmonics of [false, true]) {
        const samples = sine(hz, rate, 0.2, harmonics);
        const pitch = estimatePitch(samples, rate, measureLevel(samples).rms);
        assert.ok(pitch !== null && Math.abs(pitch - hz) / hz < 0.02, 'rate=' + rate + ', hz=' + hz + ', got=' + pitch);
      }
    }
  }
});
test('silence, quiet input, DC and seeded noise are not assigned pitch', () => {
  let seed = 32;
  const noise = Float32Array.from({ length: 4096 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.3;
  });
  for (const input of [new Float32Array(4096), new Float32Array(4096).fill(0.1), sine(220, 48000, 0.0001), noise]) {
    assert.equal(estimatePitch(input, 48000, measureLevel(input).rms), null);
  }
});

test('pitch display labels the previous real estimate and expires without new input', () => {
  const display = new PitchReadout();
  assert.deepEqual(display.update(null, 0), { hz: null, state: 'missing' });
  assert.deepEqual(display.update(220, 100), { hz: 220, state: 'current' });
  assert.deepEqual(display.update(null, 200), { hz: 220, state: 'previous' });
  assert.deepEqual(display.update(null, 1599), { hz: 220, state: 'previous' });
  assert.deepEqual(display.update(null, 1600), { hz: null, state: 'missing' });
  assert.deepEqual(display.update(null, 1700), { hz: null, state: 'missing' });
});

test('a new estimate replaces the held value; stopping clears it immediately', () => {
  const display = new PitchReadout();
  display.update(110, 0);
  assert.deepEqual(display.update(330, 300), { hz: 330, state: 'current' });
  display.clear();
  assert.deepEqual(display.update(null, 400), { hz: null, state: 'missing' });
  assert.deepEqual(display.update(NaN, 500), { hz: null, state: 'missing' });
});
