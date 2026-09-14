// Readability only: retain one actual estimate briefly, never invent missing data.
export class PitchReadout {
  constructor() { this.clear(); }

  clear() {
    this.hz = null;
    this.measuredAt = null;
  }

  update(hz, time) {
    if (Number.isFinite(hz) && hz >= 60 && hz <= 1000) {
      this.hz = hz;
      this.measuredAt = time;
      return { hz, state: 'current' };
    }
    if (this.hz !== null && time >= this.measuredAt && time - this.measuredAt < 1500) {
      return { hz: this.hz, state: 'previous' };
    }
    this.clear();
    return { hz: null, state: 'missing' };
  }
}

// Deterministic signal measurements; no model, classification or persistence.
export function measureLevel(samples) {
  if (!samples.length) return { rms: 0, dbfs: null, peak: 0 };
  let energy = 0, peak = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) return { rms: 0, dbfs: null, peak: 0 };
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(energy / samples.length);
  return { rms, dbfs: rms > 0 ? 20 * Math.log10(rms) : null, peak };
}

// YIN-style cumulative normalized difference, with a conservative periodicity gate.
// A box average reduces work to <=12 kHz; this is a rehearsal aid, not a tuner.
export function estimatePitch(samples, sampleRate, rms, threshold = 0.12) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || rms < 0.003) return null;
  const step = Math.max(1, Math.ceil(sampleRate / 12000));
  const rate = sampleRate / step;
  const signal = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < signal.length; i++) {
    for (let j = 0; j < step; j++) signal[i] += samples[i * step + j] / step;
  }
  const minLag = Math.max(2, Math.floor(rate / 1000));
  const maxLag = Math.ceil(rate / 60);
  const windowLength = signal.length - maxLag;
  if (windowLength < maxLag) return null;
  const difference = new Float32Array(maxLag + 1);
  difference[0] = 1;
  let cumulative = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < windowLength; i++) {
      const delta = signal[i] - signal[i + lag];
      sum += delta * delta;
    }
    cumulative += sum;
    difference[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
  }
  let result = null;
  for (let lag = minLag; lag < maxLag; lag++) {
    if (difference[lag] >= threshold) continue;
    while (lag + 1 <= maxLag && difference[lag + 1] < difference[lag]) lag++;
    let refined = lag;
    if (lag > 0 && lag < maxLag) {
      const left = difference[lag - 1], center = difference[lag], right = difference[lag + 1];
      const denominator = left - 2 * center + right;
      if (denominator !== 0) refined += (left - right) / (2 * denominator);
    }
    const hz = rate / refined;
    if (Number.isFinite(hz) && hz >= 60 && hz <= 1000) result = hz;
    break;
  }
  signal.fill(0);
  difference.fill(0);
  return result;
}
