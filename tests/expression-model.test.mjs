import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpressionModel, hueForPower, LightSmoother, LevelEnvelope, MessageHold, Band } from '../public/expression-model.js';
import { measureLevel, estimatePitch } from '../public/analysis.js';
import { measureSpectralBalance, measureVoiceQuality, toSemitone } from '../public/spectrum.js';

const STEP = 100;

// A plain speaking voice with small, deterministic frame-to-frame variation, so
// the rolling scale has a real spread rather than a degenerate one.
function baseline(index, overrides = {}) {
  const wobble = Math.sin(index / 3);
  return {
    dbfs: -26 + wobble,
    semitone: 45 + 0.4 * wobble,
    spectral: { alphaRatioDb: 10 + 0.5 * wobble, hammarbergDb: 18 + 0.5 * wobble },
    quality: { jitter: 0.012, shimmer: 0.05, hnrDb: 14 + wobble },
    ...overrides
  };
}

function drive(model, count, make, startTime = 0) {
  let last = null;
  for (let index = 0; index < count; index++) last = model.update(make(index), startTime + index * STEP);
  return last;
}

test('silence is reported as no measurement, never as a feeling', () => {
  const model = new ExpressionModel();
  const result = drive(model, 120, () => ({ dbfs: -80, semitone: null, spectral: {}, quality: {} }));
  assert.equal(result.state, 'unavailable');
  assert.equal(result.axes, null);
  assert.equal(result.confidence, 0);
  assert.match(result.reason, /静か/);
});

test('loud input without a periodic voice is reported as no measurement', () => {
  const model = new ExpressionModel();
  const result = drive(model, 120, () => ({
    dbfs: -18, semitone: null,
    spectral: { alphaRatioDb: -3, hammarbergDb: 1 }, quality: {}
  }));
  assert.equal(result.state, 'unavailable');
  assert.equal(result.axes, null);
  assert.match(result.reason, /周期的な音/);
});

test('the first seconds are reported as warming up, not as a result', () => {
  const model = new ExpressionModel();
  const early = drive(model, 20, baseline);
  assert.equal(early.state, 'warming');
  assert.equal(early.axes, null);
  assert.equal(early.confidence, 0);
});

test('a louder, higher, more varied passage raises the power axis', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  const result = drive(model, 20, index => baseline(index, {
    dbfs: -12 + Math.sin(index / 3), semitone: 53 + 0.4 * Math.sin(index / 3)
  }), 100 * STEP);
  assert.equal(result.state, 'ready');
  assert.ok(result.axes.power > 0.4, 'power=' + result.axes.power);
});

test('shifting energy to high frequencies raises the edge axis alone', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  const result = drive(model, 20, index => baseline(index, {
    spectral: { alphaRatioDb: 1 + 0.5 * Math.sin(index / 3), hammarbergDb: 9 + 0.5 * Math.sin(index / 3) }
  }), 100 * STEP);
  assert.equal(result.state, 'ready');
  assert.ok(result.axes.edge > 0.4, 'edge=' + result.axes.edge);
  assert.ok(Math.abs(result.axes.power) < 0.25, 'power moved too: ' + result.axes.power);
});

test('period and amplitude irregularity raises the waver axis', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  const result = drive(model, 20, index => baseline(index, {
    quality: { jitter: 0.06, shimmer: 0.2, hnrDb: 5 + Math.sin(index / 3) }
  }), 100 * STEP);
  assert.ok(result.axes.waver > 0.5, 'waver=' + result.axes.waver);
});

test('a wider pitch and level range raises the spread axis', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  const result = drive(model, 20, index => baseline(index, {
    dbfs: -26 + 9 * Math.sin(index / 2), semitone: 45 + 7 * Math.sin(index / 2)
  }), 100 * STEP);
  assert.ok(result.axes.spread > 0.4, 'spread=' + result.axes.spread);
});

test('an unchanging voice stays near the middle of every axis', () => {
  const model = new ExpressionModel();
  const result = drive(model, 140, baseline);
  assert.equal(result.state, 'ready');
  for (const [axis, value] of Object.entries(result.axes)) {
    assert.ok(Math.abs(value) < 0.35, axis + ' drifted to ' + value);
  }
  assert.match(result.reason, /いつもの範囲/);
});

test('reset leaves no trace of the previous voice', () => {
  const model = new ExpressionModel();
  drive(model, 140, baseline);
  model.reset();
  assert.deepEqual(model.frames, []);
  assert.equal(model.startedAt, null);
  assert.equal(model.update(baseline(0), 0).state, 'warming');
});

test('identical input gives identical output', () => {
  const a = new ExpressionModel(), b = new ExpressionModel();
  assert.deepEqual(drive(a, 140, baseline), drive(b, 140, baseline));
});

test('end to end: real audio in, and silence still yields no result', () => {
  const rate = 48000;
  const model = new ExpressionModel();
  const frameFor = samples => {
    const { rms, dbfs } = measureLevel(samples);
    const hz = estimatePitch(samples, rate, rms);
    return {
      dbfs,
      semitone: toSemitone(hz),
      spectral: measureSpectralBalance(samples, rate),
      quality: measureVoiceQuality(samples, rate, hz)
    };
  };
  const voice = Float32Array.from({ length: 4096 }, (_, i) =>
    0.25 * (Math.sin(2 * Math.PI * 200 * i / rate) + 0.4 * Math.sin(2 * Math.PI * 600 * i / rate)));
  const spoken = drive(model, 120, () => frameFor(voice));
  assert.equal(spoken.state, 'ready');
  assert.ok(Number.isFinite(spoken.features.alphaRatioDb));
  assert.ok(Number.isFinite(spoken.features.semitone));

  const quiet = drive(model, 30, () => frameFor(new Float32Array(4096)), 120 * STEP);
  assert.equal(quiet.state, 'unavailable');
  assert.equal(quiet.axes, null);
});

const unvoiced = index => ({
  dbfs: -24 + Math.sin(index / 3), semitone: null,
  spectral: { alphaRatioDb: 9 + 0.5 * Math.sin(index / 3), hammarbergDb: 17 + 0.5 * Math.sin(index / 3) },
  quality: {}
});

test('a short unvoiced gap is bridged; 張り keeps reading through it', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  // 0.8 s of consonants and breath: the 1.2 s window still holds voiced frames.
  const result = drive(model, 8, unvoiced, 100 * STEP);
  assert.equal(result.state, 'ready');
  assert.ok(Number.isFinite(result.axes.edge), 'edge went blank across a short gap: ' + result.axes.edge);
  assert.equal(result.coverage.edge, 1);
});

test('a long unvoiced stretch keeps only the axes that never needed a pitch', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  const result = drive(model, 13, unvoiced, 100 * STEP);
  assert.equal(result.state, 'ready');
  // Loudness and the rate of loudness peaks do not need a fundamental frequency.
  assert.ok(Number.isFinite(result.axes.power), 'power went blank: ' + result.axes.power);
  assert.ok(Math.abs(result.coverage.power - 2 / 3) < 1e-9, 'power coverage=' + result.coverage.power);
  assert.ok(Number.isFinite(result.axes.spread), 'spread went blank');
  assert.equal(result.coverage.spread, 0.5);
  // These describe the voice itself and have nothing to measure without periods.
  assert.equal(result.axes.waver, null, 'waver must be null, not a number');
  assert.equal(result.coverage.waver, 0);
  assert.equal(result.axes.edge, null, 'edge must not read the spectrum of a breath');
  assert.equal(result.coverage.edge, 0);
});

test('a reading with nothing measured is null, never a measured zero', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  const result = drive(model, 13, unvoiced, 100 * STEP);
  for (const [axis, value] of Object.entries(result.axes)) {
    assert.equal(value === null, result.coverage[axis] === 0, axis + ' disagrees with its coverage');
  }
});

test('the voice-present window expires, and then nothing is reported', () => {
  const model = new ExpressionModel();
  drive(model, 100, baseline);
  const lastVoicedAt = 99 * STEP;
  const held = model.update(unvoiced(0), lastVoicedAt + 1500);
  assert.equal(held.state, 'ready', 'still within the 1.5 s window');
  const expired = model.update(unvoiced(1), lastVoicedAt + 1600);
  assert.equal(expired.state, 'unavailable');
  assert.equal(expired.axes, null);
  assert.match(expired.reason, /周期的な音/);
});

test('an axis never claims more deviation than the share of it that was measured', () => {
  const model = new ExpressionModel();
  let checked = 0;
  for (let index = 0; index < 300; index++) {
    const wobble = Math.sin(index / 3), swing = Math.sin(index / 7);
    const voiced = index % 17 > 4;
    const frame = voiced
      ? baseline(index, { dbfs: -22 + 6 * swing, semitone: 46 + 5 * swing })
      : unvoiced(index);
    const result = model.update(frame, index * STEP);
    if (result.state !== 'ready') continue;
    for (const [axis, value] of Object.entries(result.axes)) {
      const share = result.coverage[axis];
      if (value === null) { assert.equal(share, 0, axis); continue; }
      assert.ok(Math.abs(value) <= share + 1e-9,
        axis + ' claimed ' + value.toFixed(3) + ' on only ' + (share * 100).toFixed(0) + '% coverage (frame ' + index + ', wobble ' + wobble.toFixed(2) + ')');
      checked++;
    }
  }
  assert.ok(checked > 100, 'expected many ready frames, got ' + checked);
});

test('the light colour follows the power axis, monotonically and without wrapping', () => {
  const neutral = hueForPower(0);
  assert.equal(hueForPower(null), neutral, 'no reading must fall back to the neutral hue');
  assert.equal(hueForPower(NaN), neutral);
  assert.equal(hueForPower(undefined), neutral);
  let previous = Infinity;
  for (let power = -1; power <= 1.0001; power += 0.1) {
    const hue = hueForPower(power);
    assert.ok(hue < previous, 'hue must fall as power rises: ' + power + ' gave ' + hue);
    assert.ok(hue > 0 && hue < 360, 'hue left the range at power=' + power + ': ' + hue);
    previous = hue;
  }
  // Cool below the speaker's own recent range, warm above it.
  assert.ok(hueForPower(-1) > neutral && hueForPower(1) < neutral);
  // Values beyond the axis range clamp rather than wrapping to the other end.
  assert.equal(hueForPower(-9), hueForPower(-1));
  assert.equal(hueForPower(9), hueForPower(1));
});

test('the stage light eases instead of blinking, and fades out rather than snapping', () => {
  const smoother = new LightSmoother();
  const neutral = hueForPower(0);
  assert.deepEqual(smoother.update(null, 0), { hue: neutral, presence: 0 });

  // Rising into a strong reading: the light comes up over time, not at once.
  let previous = 0;
  for (let step = 1; step <= 10; step++) {
    const { presence } = smoother.update(1, step * 100);
    assert.ok(presence > previous, 'presence must rise, step ' + step);
    previous = presence;
  }
  assert.ok(previous > 0.8, 'presence should approach full, got ' + previous);
  const warm = smoother.hue;
  assert.ok(warm < neutral, 'a high power axis must read warm, got ' + warm);

  // A gap holds the hue and fades the light instead of jumping to neutral.
  const gap = smoother.update(null, 1100);
  assert.equal(gap.hue, warm, 'hue must be held, not snapped, during a gap');
  assert.ok(gap.presence < previous, 'presence must fall during a gap');
  assert.ok(gap.presence > 0, 'the light must fade, not cut out');

  // One missing frame in a run cannot swing the colour across the range.
  const steady = new LightSmoother();
  for (let step = 0; step < 20; step++) steady.update(1, step * 100);
  const before = steady.hue;
  steady.update(null, 2000);
  steady.update(1, 2100);
  assert.ok(Math.abs(steady.hue - before) < 5, 'a single gap moved the hue by ' + Math.abs(steady.hue - before));

  smoother.reset();
  assert.equal(smoother.hue, neutral);
  assert.equal(smoother.presence, 0);
});

test('the light rises quickly, falls slowly, and holds the widest moment', () => {
  const envelope = new LevelEnvelope();
  let time = 0;
  envelope.update(0, time);
  // A syllable arrives: the light must be most of the way up within ~150 ms.
  for (let step = 0; step < 2; step++) envelope.update(1, time += 100);
  const attacked = envelope.level;
  assert.ok(attacked > 0.7, 'attack too slow: ' + attacked);

  // The gap between words must not put the light out.
  envelope.update(0, time += 100);
  const afterOneGapFrame = envelope.level;
  assert.ok(afterOneGapFrame > attacked * 0.8, 'one quiet frame dimmed it to ' + afterOneGapFrame);
  for (let step = 0; step < 4; step++) envelope.update(0, time += 100);
  assert.ok(envelope.level > 0.3, 'half a second of silence emptied the light: ' + envelope.level);
  // The held peak outlasts the level, so a wide delivery stays comparable.
  assert.ok(envelope.peak > envelope.level, 'peak must lag the level');

  // It still goes out when the voice really stops.
  for (let step = 0; step < 60; step++) envelope.update(0, time += 100);
  assert.ok(envelope.level < 0.01, 'light never went out: ' + envelope.level);
  assert.ok(envelope.peak < 0.15, 'peak never fell: ' + envelope.peak);

  // A peak is never higher than something actually measured.
  const quiet = new LevelEnvelope();
  let at = 0;
  for (let step = 0; step < 40; step++) quiet.update(0.3, at += 100);
  assert.ok(quiet.peak <= 0.3 + 1e-9, 'peak exceeded the input: ' + quiet.peak);

  quiet.reset();
  assert.equal(quiet.level, 0);
  assert.equal(quiet.peak, 0);
});

test('a caption stays put long enough to be read, and the newest wording wins', () => {
  const hold = new MessageHold({ minMs: 2000 });
  assert.equal(hold.update('A', 0), 'A', 'the first caption shows at once');
  assert.equal(hold.update('B', 500), 'A', 'too soon to change');
  assert.equal(hold.update('C', 1500), 'A', 'still too soon');
  // After the hold, the most recent wording is used, not the one queued first.
  assert.equal(hold.update('C', 2100), 'C');
  assert.equal(hold.update('C', 2200), 'C', 'an unchanged caption does not restart the hold');
  assert.equal(hold.update('D', 3000), 'C', 'the hold restarts from the last change');
  assert.equal(hold.update('D', 4200), 'D');
  // Stopping and errors must not wait.
  assert.equal(hold.update('停止しました。', 4300, true), '停止しました。');
  hold.reset();
  assert.equal(hold.shown, null);
  assert.equal(hold.update('E', 9999), 'E');
});

test('wording near a threshold does not flip back and forth', () => {
  const band = new Band({ enter: 0.2, exit: 0.1 });
  assert.equal(band.update(0.05), 0);
  assert.equal(band.update(0.19), 0, 'entering needs a clear reading');
  assert.equal(band.update(0.25), 1);
  assert.equal(band.update(0.15), 1, 'a small dip must not leave the band');
  assert.equal(band.update(0.05), 0, 'a clear drop does leave it');
  assert.equal(band.update(-0.25), -1);
  assert.equal(band.update(-0.15), -1);
  assert.equal(band.update(-0.05), 0);
  // A value resting exactly on the entry threshold settles instead of oscillating.
  let flips = 0, previous = band.update(0.2);
  for (let step = 0; step < 50; step++) {
    const next = band.update(0.2 + (step % 2 ? 0.001 : -0.001));
    if (next !== previous) flips++;
    previous = next;
  }
  assert.ok(flips <= 1, 'wording flipped ' + flips + ' times on a steady value');
  assert.equal(band.update(null), 0, 'no reading means no band');
});

test('the stage caption is short enough to read at a glance', () => {
  // The audience is watching a performance, not the screen. Anything past about
  // 30 characters cannot be taken in during a glance, however long it is held.
  const captions = [
    'マイクを開始して、台詞を話してください。',
    '反応中 ／ 勢い：強め',
    '反応中 ／ 高さは直前の値 ／ 勢い：いつもの範囲',
    '音量に反応中 ／ 高さは未検出 ／ 勢い：弱め',
    '台詞を話すと光が反応します。'
  ];
  for (const caption of captions) {
    assert.ok(caption.length <= 30, caption.length + ' characters is too long to glance at: ' + caption);
  }
});
