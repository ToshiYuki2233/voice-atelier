import test from 'node:test';
import assert from 'node:assert/strict';
import { measureSpectralBalance, measureVoiceQuality, toSemitone } from '../public/spectrum.js';

const RATE = 48000;

function tone(hz, amplitude = 0.3, length = 4096) {
  return Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / RATE));
}

function mix(lowHz, highHz, highShare, length = 4096) {
  return Float32Array.from({ length }, (_, i) =>
    0.3 * (Math.sin(2 * Math.PI * lowHz * i / RATE) + highShare * Math.sin(2 * Math.PI * highHz * i / RATE)));
}

// Cycle-by-cycle construction gives exact, known jitter and shimmer.
function periodic(periodFor, amplitudeFor, length = 4096) {
  const out = new Float32Array(length);
  let index = 0, cycle = 0;
  while (index < length) {
    const period = periodFor(cycle), amplitude = amplitudeFor(cycle);
    for (let j = 0; j < period && index < length; j++, index++) {
      out[index] = amplitude * Math.sin(2 * Math.PI * j / period);
    }
    cycle++;
  }
  return out;
}

function noise(amplitude, length = 4096, seed = 7) {
  let state = seed;
  return Float32Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 4294967296 - 0.5) * 2 * amplitude;
  });
}

test('alpha ratio reports the actual low-to-high energy balance', () => {
  const low = measureSpectralBalance(tone(220), RATE);
  const high = measureSpectralBalance(tone(3000), RATE);
  assert.ok(low.windows > 3, 'expected several 20 ms windows, got ' + low.windows);
  assert.ok(low.alphaRatioDb > 20, 'low tone alpha ratio=' + low.alphaRatioDb);
  assert.ok(high.alphaRatioDb < -20, 'high tone alpha ratio=' + high.alphaRatioDb);
});

test('alpha ratio falls monotonically as high-frequency content is added', () => {
  let previous = Infinity;
  for (const share of [0, 0.1, 0.3, 0.6, 1]) {
    const { alphaRatioDb } = measureSpectralBalance(mix(220, 3000, share), RATE);
    assert.ok(alphaRatioDb < previous, 'share=' + share + ' gave ' + alphaRatioDb + ', not below ' + previous);
    previous = alphaRatioDb;
  }
});

test('Hammarberg index compares the strongest peak of each region', () => {
  assert.ok(measureSpectralBalance(tone(500), RATE).hammarbergDb > 20);
  assert.ok(measureSpectralBalance(tone(3500), RATE).hammarbergDb < -20);
});

test('spectral balance declines unusable input instead of substituting values', () => {
  const empty = { alphaRatioDb: null, hammarbergDb: null, slopeLowDb: null, slopeMidDb: null, windows: 0 };
  assert.deepEqual(measureSpectralBalance(new Float32Array(64), RATE), empty);
  assert.deepEqual(measureSpectralBalance(tone(220), 8000), empty);
  assert.deepEqual(measureSpectralBalance(tone(220), NaN), empty);
  const broken = tone(220);
  broken.fill(NaN);
  assert.equal(measureSpectralBalance(broken, RATE).alphaRatioDb, null);
});

test('silence has no spectral balance', () => {
  assert.equal(measureSpectralBalance(new Float32Array(4096), RATE).alphaRatioDb, null);
});

test('jitter and shimmer recover the period and amplitude variation actually present', () => {
  const steady = measureVoiceQuality(periodic(() => 240, () => 0.3), RATE, 200);
  assert.ok(steady.jitter < 0.01, 'steady jitter=' + steady.jitter);
  assert.ok(steady.shimmer < 0.01, 'steady shimmer=' + steady.shimmer);

  const uneven = measureVoiceQuality(periodic(cycle => cycle % 2 ? 232 : 248, () => 0.3), RATE, 200);
  assert.ok(uneven.jitter > steady.jitter * 5, 'uneven jitter=' + uneven.jitter);

  const uneverAmplitude = measureVoiceQuality(periodic(() => 240, cycle => cycle % 2 ? 0.2 : 0.3), RATE, 200);
  assert.ok(uneverAmplitude.shimmer > steady.shimmer + 0.2, 'shimmer=' + uneverAmplitude.shimmer);
});

test('harmonics-to-noise ratio falls monotonically as noise is added', () => {
  const clean = periodic(() => 240, () => 0.3);
  let previous = Infinity;
  const hiss = noise(1);
  for (const level of [0, 0.02, 0.08, 0.2]) {
    const mixed = Float32Array.from(clean, (value, i) => value + level * hiss[i]);
    const { hnrDb } = measureVoiceQuality(mixed, RATE, 200);
    assert.ok(hnrDb < previous, 'noise=' + level + ' gave HNR ' + hnrDb + ', not below ' + previous);
    previous = hnrDb;
  }
});

test('voice quality needs an actual pitch and enough periods', () => {
  const empty = { jitter: null, shimmer: null, hnrDb: null, periods: 0 };
  assert.deepEqual(measureVoiceQuality(tone(200), RATE, null), empty);
  assert.deepEqual(measureVoiceQuality(tone(200), RATE, 0), empty);
  assert.deepEqual(measureVoiceQuality(new Float32Array(64), RATE, 200), empty);
});

test('semitone scale starts at 27.5 Hz and clips below semitone 1', () => {
  assert.equal(toSemitone(27.5), 1);
  assert.equal(toSemitone(20), 1);
  assert.ok(Math.abs(toSemitone(55) - 12) < 1e-9);
  assert.ok(Math.abs(toSemitone(440) - 48) < 1e-9);
  assert.equal(toSemitone(null), null);
  assert.equal(toSemitone(-5), null);
});

test('measurements are deterministic for identical input', () => {
  const samples = mix(220, 3000, 0.4);
  assert.deepEqual(measureSpectralBalance(samples, RATE), measureSpectralBalance(samples, RATE));
  assert.deepEqual(measureVoiceQuality(samples, RATE, 220), measureVoiceQuality(samples, RATE, 220));
});
