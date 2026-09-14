// Spectral balance and voice quality measurements.
//
// Definitions follow the GeMAPS recommendation (Eyben et al., "The Geneva
// Minimalistic Acoustic Parameter Set (GeMAPS) for Voice Research and Affective
// Computing", IEEE Transactions on Affective Computing 7(2), 2016; the article
// is published under CC BY 3.0). Written here from those published definitions.
// No openSMILE code (audEERING Research License, non-commercial) and no Praat
// code (GPLv3+) is copied or linked. Deviations from the published analysis
// conditions are recorded in docs/EMOTION-RULE-MODEL.md.
//
// Every function is deterministic, allocates only for the current frame, and
// keeps no state between calls. Nothing here is trained, fitted or persisted.

// In-place iterative radix-2 FFT over the live frame only.
function transform(real, imaginary) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = real[i]; real[i] = real[j]; real[j] = r;
      const m = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = m;
    }
  }
  for (let span = 2; span <= size; span <<= 1) {
    const angle = -2 * Math.PI / span;
    const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
    const half = span >> 1;
    for (let start = 0; start < size; start += span) {
      let factorReal = 1, factorImaginary = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half;
        const productReal = real[b] * factorReal - imaginary[b] * factorImaginary;
        const productImaginary = real[b] * factorImaginary + imaginary[b] * factorReal;
        real[b] = real[a] - productReal;
        imaginary[b] = imaginary[a] - productImaginary;
        real[a] += productReal;
        imaginary[a] += productImaginary;
        const nextReal = factorReal * stepReal - factorImaginary * stepImaginary;
        factorImaginary = factorReal * stepImaginary + factorImaginary * stepReal;
        factorReal = nextReal;
      }
    }
  }
}

function firstBin(binHz, lowHz) {
  return Math.max(1, Math.ceil(lowHz / binHz));
}

function bandEnergy(power, binHz, lowHz, highHz) {
  let total = 0;
  for (let bin = firstBin(binHz, lowHz); bin < power.length && bin * binHz <= highHz; bin++) total += power[bin];
  return total;
}

function bandPeak(power, binHz, lowHz, highHz) {
  let peak = 0;
  for (let bin = firstBin(binHz, lowHz); bin < power.length && bin * binHz <= highHz; bin++) {
    peak = Math.max(peak, power[bin]);
  }
  return peak;
}

// Least-squares slope of the logarithmic power spectrum in one band, dB/kHz.
function bandSlope(power, binHz, lowHz, highHz) {
  let count = 0, sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let bin = firstBin(binHz, lowHz); bin < power.length && bin * binHz <= highHz; bin++) {
    const x = bin * binHz / 1000;
    const y = 10 * Math.log10(power[bin] + 1e-20);
    count++; sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  }
  const denominator = count * sumXX - sumX * sumX;
  return count < 3 || denominator === 0 ? null : (count * sumXY - sumX * sumY) / denominator;
}

// Alpha Ratio: summed energy 50-1000 Hz over 1-5 kHz.
// Hammarberg Index: strongest peak in 0-2 kHz over the strongest peak in 2-5 kHz.
// Spectral slopes: 0-500 Hz and 500-1500 Hz.
// Averaged over 20 ms Hamming windows 10 ms apart, zero-padded, as published.
export function measureSpectralBalance(samples, sampleRate) {
  const empty = { alphaRatioDb: null, hammarbergDb: null, slopeLowDb: null, slopeMidDb: null, windows: 0 };
  if (!Number.isFinite(sampleRate) || sampleRate < 11025) return empty;
  const windowLength = Math.round(sampleRate * 0.02);
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  if (windowLength < 8 || samples.length < windowLength) return empty;
  let size = 1;
  while (size < windowLength * 2) size <<= 1;
  const binHz = sampleRate / size;
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  const power = new Float64Array(size / 2);
  const totals = { alphaRatioDb: 0, hammarbergDb: 0, slopeLowDb: 0, slopeMidDb: 0 };
  const counts = { alphaRatioDb: 0, hammarbergDb: 0, slopeLowDb: 0, slopeMidDb: 0 };
  let windows = 0;
  for (let offset = 0; offset + windowLength <= samples.length; offset += hop) {
    real.fill(0); imaginary.fill(0);
    let usable = true;
    for (let i = 0; i < windowLength; i++) {
      const value = samples[offset + i];
      if (!Number.isFinite(value)) { usable = false; break; }
      real[i] = value * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (windowLength - 1)));
    }
    if (!usable) continue;
    transform(real, imaginary);
    for (let bin = 0; bin < power.length; bin++) power[bin] = real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
    windows++;
    const low = bandEnergy(power, binHz, 50, 1000), high = bandEnergy(power, binHz, 1000, 5000);
    if (low > 0 && high > 0) { totals.alphaRatioDb += 10 * Math.log10(low / high); counts.alphaRatioDb++; }
    const peakLow = bandPeak(power, binHz, 0, 2000), peakHigh = bandPeak(power, binHz, 2000, 5000);
    if (peakLow > 0 && peakHigh > 0) { totals.hammarbergDb += 10 * Math.log10(peakLow / peakHigh); counts.hammarbergDb++; }
    const slopeLow = bandSlope(power, binHz, 0, 500), slopeMid = bandSlope(power, binHz, 500, 1500);
    if (slopeLow !== null) { totals.slopeLowDb += slopeLow; counts.slopeLowDb++; }
    if (slopeMid !== null) { totals.slopeMidDb += slopeMid; counts.slopeMidDb++; }
  }
  real.fill(0); imaginary.fill(0); power.fill(0);
  const mean = key => counts[key] ? totals[key] / counts[key] : null;
  return {
    alphaRatioDb: mean('alphaRatioDb'),
    hammarbergDb: mean('hammarbergDb'),
    slopeLowDb: mean('slopeLowDb'),
    slopeMidDb: mean('slopeMidDb'),
    windows
  };
}

// Local jitter and shimmer from consecutive period peaks, and HNR from the
// normalised autocorrelation at the pitch lag. Needs an actual pitch estimate:
// without one this returns no values rather than a substitute.
export function measureVoiceQuality(samples, sampleRate, hz) {
  const empty = { jitter: null, shimmer: null, hnrDb: null, periods: 0 };
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(sampleRate) || sampleRate < 8000) return empty;
  const period = sampleRate / hz;
  if (!(period >= 2) || samples.length < period * 5) return empty;
  const search = Math.max(2, Math.round(period / 4));
  const locations = [], amplitudes = [];
  let cursor = null;
  for (let start = 0; start + period <= samples.length; start += period) {
    let from = cursor === null ? Math.floor(start) : Math.round(cursor + period - search);
    let to = cursor === null ? Math.floor(start + period) : Math.round(cursor + period + search);
    from = Math.max(0, from); to = Math.min(samples.length - 1, to);
    if (to <= from) break;
    let bestIndex = from, best = -Infinity;
    for (let i = from; i <= to; i++) {
      if (!Number.isFinite(samples[i])) return empty;
      if (samples[i] > best) { best = samples[i]; bestIndex = i; }
    }
    cursor = bestIndex;
    if (best > 0) { locations.push(bestIndex); amplitudes.push(best); }
  }
  const result = { ...empty, periods: Math.max(0, locations.length - 1) };
  if (locations.length >= 4) {
    const lengths = [];
    for (let i = 1; i < locations.length; i++) lengths.push(locations[i] - locations[i - 1]);
    const meanLength = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const meanAmplitude = amplitudes.reduce((sum, value) => sum + value, 0) / amplitudes.length;
    let lengthChange = 0, amplitudeChange = 0;
    for (let i = 1; i < lengths.length; i++) lengthChange += Math.abs(lengths[i] - lengths[i - 1]);
    for (let i = 1; i < amplitudes.length; i++) amplitudeChange += Math.abs(amplitudes[i] - amplitudes[i - 1]);
    if (meanLength > 0 && lengths.length > 1) result.jitter = lengthChange / (lengths.length - 1) / meanLength;
    if (meanAmplitude > 0 && amplitudes.length > 1) result.shimmer = amplitudeChange / (amplitudes.length - 1) / meanAmplitude;
  }
  const lag = Math.round(period);
  const overlap = samples.length - lag;
  if (lag >= 2 && overlap >= lag * 2) {
    let cross = 0, energyA = 0, energyB = 0;
    for (let i = 0; i < overlap; i++) {
      const a = samples[i], b = samples[i + lag];
      if (!Number.isFinite(a) || !Number.isFinite(b)) return result;
      cross += a * b; energyA += a * a; energyB += b * b;
    }
    const norm = Math.sqrt(energyA * energyB);
    if (norm > 0) {
      const correlation = Math.min(0.999, Math.max(0.001, cross / norm));
      result.hnrDb = 10 * Math.log10(correlation / (1 - correlation));
    }
  }
  return result;
}

// Logarithmic F0 on a semitone scale starting at 27.5 Hz (semitone 0), with
// everything below semitone 1 clipped, as the published scale specifies.
export function toSemitone(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  return Math.max(1, 12 * Math.log2(hz / 27.5));
}
