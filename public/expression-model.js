// Rule-based expression model.
//
// This is NOT an emotion classifier and must never be presented as one. It maps
// measured acoustic quantities onto four descriptive axes of the voice. There
// are no trained weights, no fitted coefficients, no model file, and nothing is
// learned from, adapted to, or stored about the speaker. Every weight below is
// an equal share within its feature family, set by hand; none was tuned on any
// recording. See docs/EMOTION-RULE-MODEL.md.
//
// The features come from the GeMAPS recommendation (Eyben et al., IEEE TAFFC
// 2016, CC BY 3.0), measured in spectrum.js and analysis.js.
//
// Axes, named for what is measured rather than for any feeling:
//   power   勢い   level, pitch height, rate of loudness peaks
//   edge    張り   spectral balance (Alpha Ratio, Hammarberg Index)
//   waver   揺れ   jitter, shimmer, harmonics-to-noise ratio
//   spread  幅     pitch range and level range over the last moment

// Robust spread so one loud frame cannot move the scale. `floor` is the
// smallest spread treated as meaningful, not a fitted parameter.
function robustScale(values, centre, floor) {
  if (values.length < 2) return floor;
  const deviations = values.map(value => Math.abs(value - centre)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  return Math.max(1.4826 * mad, floor);
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

// Local maxima separated by at least `prominence`, so steady speech is not
// counted as a stream of peaks.
function countPeaks(values, prominence) {
  if (values.length < 3) return 0;
  let count = 0, rising = true, peak = values[0], trough = values[0];
  for (const value of values) {
    if (rising) {
      if (value > peak) peak = value;
      else if (peak - value >= prominence) { count++; rising = false; trough = value; }
    } else if (value < trough) trough = value;
    else if (value - trough >= prominence) { rising = true; peak = value; }
  }
  return count;
}

// Smallest spread that counts as a real difference, per feature and unit.
const FLOORS = {
  semitone: 0.6, dbfs: 1.5, peakRate: 0.35,
  alphaRatioDb: 1.2, hammarbergDb: 1.2,
  jitter: 0.004, shimmer: 0.012, hnrDb: 1.5,
  pitchSpread: 0.6, levelSpread: 1.5
};

// [feature, sign, weight]. Every weight is 1: equal shares by design, because
// any other ratio would have to come from fitting to recordings. The weights are
// here so that availability can be counted in the same units, not so that they
// can be tuned.
//
// An axis divides by the TOTAL weight, not by the weight actually measured. A
// feature that cannot be measured therefore contributes nothing and pulls the
// axis toward the middle, instead of letting the remaining features stand in for
// it. The axis never claims more deviation than the available data supports.
const AXES = {
  power: [['semitone', 1, 1], ['dbfs', 1, 1], ['peakRate', 1, 1]],
  edge: [['alphaRatioDb', -1, 1], ['hammarbergDb', -1, 1]],
  waver: [['jitter', 1, 1], ['shimmer', 1, 1], ['hnrDb', -1, 1]],
  spread: [['pitchSpread', 1, 1], ['levelSpread', 1, 1]]
};

export const AXIS_LABELS = { power: '勢い', edge: '張り', waver: '揺れ', spread: '幅' };

export class ExpressionModel {
  // voicePresenceMs matches the 1.5 s the display already holds a real pitch
  // estimate for (PitchReadout), so the two use the same idea of "a voice is
  // still here" rather than two different ones.
  constructor({ windowMs = 12000, shortMs = 1200, peakWindowMs = 2500, voicePresenceMs = 1500,
                minSeconds = 4, floorDbfs = -50, peakProminenceDb = 3 } = {}) {
    this.windowMs = windowMs;
    this.shortMs = shortMs;
    this.peakWindowMs = peakWindowMs;
    this.voicePresenceMs = voicePresenceMs;
    this.minSeconds = minSeconds;
    this.floorDbfs = floorDbfs;
    this.peakProminenceDb = peakProminenceDb;
    this.reset();
  }

  // Called on stop and on every restart. Leaves nothing behind.
  reset() {
    this.frames = [];
    this.startedAt = null;
    this.lastVoicedAt = null;
  }

  // frame: { dbfs, semitone, spectral: {...}, quality: {...} }
  update(frame, time) {
    if (!Number.isFinite(time)) return this.unavailable('時刻を取得できません。');
    if (this.startedAt === null) this.startedAt = time;
    const voiced = Number.isFinite(frame.semitone);
    const audible = Number.isFinite(frame.dbfs) && frame.dbfs >= this.floorDbfs;
    // Raw per-frame values feed derive(); derived values are stored alongside so
    // that a value is always compared against the same kind of quantity.
    const entry = {
      time, voiced, audible, derived: null,
      raw: {
        dbfs: Number.isFinite(frame.dbfs) ? frame.dbfs : null,
        semitone: voiced ? frame.semitone : null,
        // Voiced frames only. The spectral balance of a fricative or a breath is
        // a well-defined number, but it describes the consonant, not the effort
        // in the voice, so averaging the two together quietly changes what 張り
        // means. GeMAPS keeps voiced and unvoiced spectral statistics as
        // separate parameters for the same reason. derive() takes the median
        // over the last 1.2 s, so short unvoiced gaps are still bridged.
        alphaRatioDb: voiced ? nullable(frame.spectral?.alphaRatioDb) : null,
        hammarbergDb: voiced ? nullable(frame.spectral?.hammarbergDb) : null,
        jitter: voiced ? nullable(frame.quality?.jitter) : null,
        shimmer: voiced ? nullable(frame.quality?.shimmer) : null,
        hnrDb: voiced ? nullable(frame.quality?.hnrDb) : null
      }
    };
    this.frames.push(entry);
    const cutoff = time - this.windowMs;
    while (this.frames.length && this.frames[0].time < cutoff) this.frames.shift();

    if (voiced) this.lastVoicedAt = time;
    const recent = this.frames.filter(item => item.time >= time - this.shortMs);
    const voicedRatio = recent.length ? recent.filter(item => item.voiced).length / recent.length : 0;
    const derived = this.derive(recent, time);
    entry.derived = derived;
    if (!audible) return this.unavailable('入力が静かすぎます。声を出すと表示されます。', { voicedRatio });
    // A voice must have been heard recently for any axis to mean anything: this
    // keeps a door slam or steady noise from producing a reading. It is not a
    // demand that every frame be voiced, which would blank the axes that need no
    // pitch at all (the spectral balance behind 張り) whenever a consonant,
    // breath or short pause came along.
    const present = this.lastVoicedAt !== null && time - this.lastVoicedAt <= this.voicePresenceMs;
    if (!present) return this.unavailable('声（周期的な音）を検出していません。', { voicedRatio });

    const elapsed = (time - this.startedAt) / 1000;
    const values = {};
    for (const key of Object.keys(FLOORS)) {
      const history = this.frames.map(item => item.derived?.[key]).filter(Number.isFinite);
      const current = derived[key];
      if (!Number.isFinite(current) || history.length < 8) { values[key] = null; continue; }
      const centre = median(history);
      const scale = robustScale(history, centre, FLOORS[key]);
      values[key] = Math.max(-1, Math.min(1, (current - centre) / (2.5 * scale)));
    }

    // Per-axis availability: the share of an axis's weight that is measured now.
    // An axis with nothing measured is null, never 0 — "no reading" and "no
    // deviation" must stay distinguishable all the way to the screen.
    const axes = {}, coverage = {};
    for (const [axis, members] of Object.entries(AXES)) {
      let total = 0, measured = 0, sum = 0;
      for (const [key, sign, weight] of members) {
        total += weight;
        if (values[key] === null) continue;
        measured += weight;
        sum += weight * sign * values[key];
      }
      coverage[axis] = total ? measured / total : 0;
      axes[axis] = measured ? sum / total : null;
    }
    if (elapsed < this.minSeconds) {
      return {
        state: 'warming', reason: '声の範囲を測っています。数秒お待ちください。',
        confidence: 0, axes: null, coverage, features: derived, voicedRatio
      };
    }
    const axisNames = Object.keys(AXES);
    const meanCoverage = axisNames.reduce((sum, axis) => sum + coverage[axis], 0) / axisNames.length;
    const confidence = meanCoverage * Math.min(1, elapsed / (this.minSeconds * 2));
    return {
      state: 'ready', reason: describe(axes), confidence,
      axes, coverage, features: derived, voicedRatio
    };
  }

  // Short-term values: what the voice is doing right now.
  derive(recent, time) {
    const semitones = recent.map(item => item.raw.semitone).filter(Number.isFinite);
    const levels = recent.map(item => item.raw.dbfs).filter(Number.isFinite);
    const sortedPitch = [...semitones].sort((a, b) => a - b);
    const sortedLevel = [...levels].sort((a, b) => a - b);
    const peakFrames = this.frames.filter(item => item.time >= time - this.peakWindowMs);
    const peakLevels = peakFrames.map(item => item.raw.dbfs).filter(Number.isFinite);
    const span = peakFrames.length > 1 ? (peakFrames[peakFrames.length - 1].time - peakFrames[0].time) / 1000 : 0;
    const pick = key => median(recent.map(item => item.raw[key]).filter(Number.isFinite));
    return {
      semitone: median(semitones),
      dbfs: median(levels),
      peakRate: span >= 1 ? countPeaks(peakLevels, this.peakProminenceDb) / span : null,
      pitchSpread: semitones.length >= 4 ? percentile(sortedPitch, 0.9) - percentile(sortedPitch, 0.1) : null,
      levelSpread: levels.length >= 4 ? percentile(sortedLevel, 0.9) - percentile(sortedLevel, 0.1) : null,
      alphaRatioDb: pick('alphaRatioDb'),
      hammarbergDb: pick('hammarbergDb'),
      jitter: pick('jitter'),
      shimmer: pick('shimmer'),
      hnrDb: pick('hnrDb')
    };
  }

  unavailable(reason, extra = {}) {
    const coverage = Object.fromEntries(Object.keys(AXES).map(axis => [axis, 0]));
    return { state: 'unavailable', reason, confidence: 0, axes: null, coverage, features: null, voicedRatio: 0, ...extra };
  }
}

function nullable(value) {
  return Number.isFinite(value) ? value : null;
}

// Describes the measurement, never a feeling and never a score.
function describe(axes) {
  const named = Object.entries(axes)
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) >= 0.25)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([axis, value]) => AXIS_LABELS[axis] + (value > 0 ? 'が強め' : 'が弱め'));
  return named.length ? named.join('、') + '。直前の自分の声と比べた向きです。' : 'いつもの範囲です。';
}

// The single place where a measurement becomes a colour. 勢い drives the hue
// because it was the axis that held for every measurable speaker in the Japanese
// check; 張り is deliberately not wired to the light because it did not hold.
// The hue is never given an emotion name: cool means a lower 勢い than this
// voice's own recent range, warm means a higher one, and that is all it claims.
// Monotonic and clamped, so the colour can never wrap around to the other end.
const NEUTRAL_HUE = 150, COOL_HUE = 205, WARM_HUE = 25;

export function hueForPower(power) {
  if (!Number.isFinite(power)) return NEUTRAL_HUE;
  const value = Math.max(-1, Math.min(1, power));
  return value < 0
    ? NEUTRAL_HUE + (-value) * (COOL_HUE - NEUTRAL_HUE)
    : NEUTRAL_HUE - value * (NEUTRAL_HUE - WARM_HUE);
}

// Eases the stage light so a reading that comes and goes does not make the
// colour blink. This smooths the PICTURE only: the numeric panel keeps showing
// the unsmoothed values, so nothing here hides or invents a measurement. When a
// reading is missing the light fades toward neutral instead of snapping to it.
export class LightSmoother {
  constructor({ tauMs = 500 } = {}) {
    this.tauMs = tauMs;
    this.reset();
  }

  reset() {
    this.hue = NEUTRAL_HUE;
    this.presence = 0;
    this.at = null;
  }

  update(power, time) {
    const target = hueForPower(power);
    const lit = Number.isFinite(power) ? 1 : 0;
    const elapsed = this.at === null ? 0 : Math.max(0, time - this.at);
    this.at = time;
    const step = elapsed > 0 ? 1 - Math.exp(-elapsed / this.tauMs) : 0;
    // Only chase the hue while a reading exists; otherwise hold it and fade out,
    // so a gap reads as the light dimming rather than as a colour change.
    if (lit) this.hue += (target - this.hue) * step;
    this.presence += (lit - this.presence) * step;
    return { hue: this.hue, presence: this.presence };
  }
}

// Attack and release for the stage light. A voice that pulses syllable by
// syllable would otherwise make the light flicker and collapse in every gap
// between words, which is unreadable from across a room. Rising is quick so the
// light still belongs to the voice; falling is slow so a phrase stays visible.
// This shapes the PICTURE only: the numeric panel keeps the instantaneous value,
// and the light still falls to nothing once the voice stops.
const SETTLE = 0.002;

export class LevelEnvelope {
  constructor({ attackMs = 70, releaseMs = 900, holdMs = 1800 } = {}) {
    this.attackMs = attackMs;
    this.releaseMs = releaseMs;
    this.holdMs = holdMs;
    this.reset();
  }

  reset() {
    this.level = 0;
    this.peak = 0;
    this.at = null;
  }

  // `peak` is a real high-water mark of the same measurement, falling slowly, so
  // the widest moment of a delivery stays on screen long enough to be compared
  // with the next one. It is never higher than something actually measured.
  update(strength, time) {
    const target = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    const elapsed = this.at === null ? 0 : Math.max(0, time - this.at);
    this.at = time;
    const tau = target > this.level ? this.attackMs : this.releaseMs;
    const step = elapsed > 0 ? 1 - Math.exp(-elapsed / tau) : 0;
    this.level += (target - this.level) * step;
    if (this.level >= this.peak) this.peak = this.level;
    else {
      const decay = elapsed > 0 ? 1 - Math.exp(-elapsed / this.holdMs) : 0;
      this.peak += (this.level - this.peak) * decay;
    }
    // An exponential decay only approaches its target, which would leave a faint
    // ring on screen long after the voice stopped. Settle it instead.
    if (Math.abs(target - this.level) < SETTLE) this.level = target;
    if (Math.abs(this.level - this.peak) < SETTLE) this.peak = this.level;
    return { level: this.level, peak: this.peak };
  }
}

// Holds a line of text still long enough to be read. The measurements update ten
// times a second; a caption that changed at that rate would be unreadable from
// the far side of a room, which is where the audience is. When several changes
// arrive during a hold, the most recent one wins, so the text lags by at most one
// hold and never drifts out of date.
export class MessageHold {
  constructor({ minMs = 2000 } = {}) {
    this.minMs = minMs;
    this.reset();
  }

  reset() {
    this.shown = null;
    this.changedAt = null;
  }

  // `immediate` is for messages the performer must not wait for, such as
  // stopping, an error, or a permission refusal.
  update(message, time, immediate = false) {
    if (this.shown === null || immediate) {
      this.shown = message;
      this.changedAt = time;
      return this.shown;
    }
    if (message === this.shown) return this.shown;
    if (this.changedAt !== null && time - this.changedAt < this.minMs) return this.shown;
    this.shown = message;
    this.changedAt = time;
    return this.shown;
  }
}

// Three-way band with hysteresis, so a value resting near a threshold does not
// flip the wording back and forth. Entering a band takes a clear reading;
// leaving it takes a clearly smaller one.
export class Band {
  constructor({ enter = 0.2, exit = 0.1 } = {}) {
    this.enter = enter;
    this.exit = exit;
    this.reset();
  }

  reset() {
    this.state = 0;
  }

  update(value) {
    if (!Number.isFinite(value)) { this.state = 0; return 0; }
    if (this.state === 1) this.state = value > this.exit ? 1 : 0;
    else if (this.state === -1) this.state = value < -this.exit ? -1 : 0;
    else this.state = value > this.enter ? 1 : value < -this.enter ? -1 : 0;
    return this.state;
  }
}
