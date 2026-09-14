// Developer check: does the rule-based model separate acted Japanese emotions?
// Runs entirely in Node. No model file, no browser, no ONNX runtime, no network
// during analysis. Public corpus audio is held in memory and zeroed; no audio is
// written. The production app is not modified and never sees this code.
//
// The predictions below are fixed BEFORE any audio is fetched. They are not
// adjusted after seeing results, and the corpus selection is the same fixed rule
// already used for the classifier comparison.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import path from 'node:path';
import { publicFixtures, dataset, datasetRevision } from './fixtures.mjs';
import { measureLevel, estimatePitch } from '../../public/analysis.js';
import { measureSpectralBalance, measureVoiceQuality, toSemitone } from '../../public/spectrum.js';
import { ExpressionModel } from '../../public/expression-model.js';

// --- Predictions, fixed in advance -----------------------------------------
// Each is counted over the 4 speakers separately, because the model compares a
// voice with itself rather than with other people.
const PREDICTIONS = [
  { id: 'P1', text: '悲しみが、その話者の6件中で勢いが最も低い', test: bySpeaker => lowest(bySpeaker, 'power', 'sad') },
  { id: 'P2', text: '怒りの勢いが悲しみより高い', test: bySpeaker => greater(bySpeaker, 'power', 'angry', 'sad') },
  { id: 'P3', text: '怒りの張りが喜びより高い', test: bySpeaker => greater(bySpeaker, 'edge', 'angry', 'happy') },
  { id: 'P4', text: '怒りの張りが悲しみより高い', test: bySpeaker => greater(bySpeaker, 'edge', 'angry', 'sad') },
  { id: 'P5', text: '恐れの揺れが平均より高い', test: bySpeaker => positive(bySpeaker, 'waver', 'fearful') },
  { id: 'P6', text: '喜びの幅が悲しみより広い', test: bySpeaker => greater(bySpeaker, 'spread', 'happy', 'sad') }
];

// Axis definitions, identical in structure to public/expression-model.js.
const AXIS_PARTS = {
  power: [['semitone', 1, 1], ['dbfs', 1, 1], ['peakRate', 1, 1]],
  edge: [['alphaRatioDb', -1, 1], ['hammarbergDb', -1, 1]],
  waver: [['jitter', 1, 1], ['shimmer', 1, 1], ['hnrDb', -1, 1]],
  spread: [['pitchSpread', 1, 1], ['levelSpread', 1, 1]]
};
const VOICING_THRESHOLDS = [0.12, 0.2, 0.3, 0.45];
const FEATURES = ['semitone', 'dbfs', 'peakRate', 'alphaRatioDb', 'hammarbergDb', 'jitter', 'shimmer', 'hnrDb', 'pitchSpread', 'levelSpread'];

const lowest = (rows, axis, label) => {
  const values = rows.filter(row => Number.isFinite(row.axes[axis]));
  const target = values.find(row => row.expected === label);
  return values.length === 6 && target ? values.every(row => row === target || row.axes[axis] > target.axes[axis]) : null;
};
const greater = (rows, axis, high, low) => {
  const a = rows.find(row => row.expected === high)?.axes[axis];
  const b = rows.find(row => row.expected === low)?.axes[axis];
  return Number.isFinite(a) && Number.isFinite(b) ? a > b : null;
};
const positive = (rows, axis, label) => {
  const value = rows.find(row => row.expected === label)?.axes[axis];
  return Number.isFinite(value) ? value > 0 : null;
};

// --- WAV decoding ----------------------------------------------------------
function decodeWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file');
  let offset = 12, format = null, data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, offset + 8 + size);
    if (id === 'fmt ') format = { code: body.readUInt16LE(0), channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    if (id === 'data') data = body;
    offset += 8 + size + (size % 2);
  }
  if (!format || !data) throw new Error('Missing fmt or data chunk');
  const { code, channels, rate, bits } = format;
  const bytes = bits / 8;
  const count = Math.floor(data.length / bytes / channels);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const at = (i * channels + channel) * bytes;
      if (code === 3 && bits === 32) sum += data.readFloatLE(at);
      else if (bits === 16) sum += data.readInt16LE(at) / 32768;
      else if (bits === 24) sum += data.readIntLE(at, 3) / 8388608;
      else if (bits === 32) sum += data.readInt32LE(at) / 2147483648;
      else if (bits === 8) sum += (data.readUInt8(at) - 128) / 128;
      else throw new Error('Unsupported sample format: ' + code + '/' + bits);
    }
    samples[i] = sum / channels;
  }
  return { samples, rate, channels, bits, code };
}

// --- Per-clip measurement --------------------------------------------------
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Same window, hop and code path as the live app; 3 s from the centre, as the
// classifier comparison used, so the two runs see the same audio.
function measureClip(samples, rate) {
  const wanted = Math.min(samples.length, Math.round(rate * 3));
  const from = Math.floor((samples.length - wanted) / 2);
  const clip = samples.subarray(from, from + wanted);
  const frameLength = 4096, hop = Math.round(rate * 0.1);
  const model = new ExpressionModel();
  // A second model with no warm-up requirement, used only to count how often the
  // gating would let the stage light show a colour during a 3 s clip. The clips
  // are shorter than the live warm-up, so the main model is always still warming.
  const live = new ExpressionModel({ minSeconds: 0 });
  const lit = { coloured: 0, neutralButLit: 0, dark: 0, switches: 0 };
  let wasColoured = null;
  const collected = Object.fromEntries(FEATURES.map(name => [name, []]));
  // Diagnostic only: how much of the clip counts as voiced at each periodicity
  // threshold. The app's own threshold (the first) is what the axes use.
  const voicedAt = Object.fromEntries(VOICING_THRESHOLDS.map(value => [value, 0]));
  let frames = 0, voicedFrames = 0, audibleFrames = 0;
  for (let offset = 0, time = 0; offset + frameLength <= clip.length; offset += hop, time += 100) {
    const frame = clip.subarray(offset, offset + frameLength);
    const { rms, dbfs } = measureLevel(frame);
    const hz = estimatePitch(frame, rate, rms);
    if (Number.isFinite(dbfs) && dbfs >= -50) audibleFrames++;
    for (const value of VOICING_THRESHOLDS) if (estimatePitch(frame, rate, rms, value) !== null) voicedAt[value]++;
    const result = model.update({
      dbfs, semitone: toSemitone(hz),
      spectral: measureSpectralBalance(frame, rate),
      quality: measureVoiceQuality(frame, rate, hz)
    }, time);
    const shown = live.update({
      dbfs, semitone: toSemitone(hz),
      spectral: measureSpectralBalance(frame, rate),
      quality: measureVoiceQuality(frame, rate, hz)
    }, time);
    const coloured = shown.state === 'ready' && Number.isFinite(shown.axes?.power);
    if (coloured) lit.coloured++;
    else if (shown.state === 'unavailable') lit.dark++;
    else lit.neutralButLit++;
    if (wasColoured !== null && wasColoured !== coloured) lit.switches++;
    wasColoured = coloured;
    frames++;
    if (hz !== null) voicedFrames++;
    if (!result.features) continue;
    for (const name of FEATURES) if (Number.isFinite(result.features[name])) collected[name].push(result.features[name]);
  }
  model.reset();
  live.reset();
  const measured = Object.fromEntries(FEATURES.map(name => [name, median(collected[name])]));
  const voicedRatioAt = Object.fromEntries(VOICING_THRESHOLDS.map(value => [value, frames ? voicedAt[value] / frames : 0]));
  return { measured, frames, light: { ...lit, colouredRatio: frames ? lit.coloured / frames : 0, switchesPerSecond: wanted ? lit.switches / (wanted / rate) : 0 }, voicedRatio: frames ? voicedFrames / frames : 0, audibleRatio: frames ? audibleFrames / frames : 0, voicedRatioAt, seconds: wanted / rate, rate };
}

// --- Per-speaker normalisation ---------------------------------------------
// The live model compares a voice with its own recent range. Here each speaker's
// six clips form that range, so no cross-speaker scale is assumed.
function normalise(rows) {
  for (const name of FEATURES) {
    const values = rows.map(row => row.measured[name]).filter(Number.isFinite);
    const mean = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length || 1);
    const deviation = Math.sqrt(variance);
    for (const row of rows) {
      const value = row.measured[name];
      row.z[name] = Number.isFinite(value) && deviation > 0 ? (value - mean) / deviation : null;
    }
  }
  for (const row of rows) {
    // Same rule as public/expression-model.js: divide by the total weight, so a
    // feature that could not be measured contributes nothing instead of letting
    // the others stand in for it.
    for (const [axis, parts] of Object.entries(AXIS_PARTS)) {
      let total = 0, measured = 0, sum = 0;
      for (const [name, sign, weight] of parts) {
        total += weight;
        if (!Number.isFinite(row.z[name])) continue;
        measured += weight;
        sum += weight * sign * row.z[name];
      }
      row.coverage[axis] = total ? measured / total : 0;
      row.axes[axis] = measured ? sum / total : null;
    }
  }
}

// --- Deterministic control signals ------------------------------------------
function control(kind, rate = 48000) {
  const length = rate * 3;
  const samples = new Float32Array(length);
  let seed = 11;
  for (let i = 0; i < length; i++) {
    if (kind === 'tone') samples[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / rate);
    else if (kind === 'noise') { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; samples[i] = (seed / 4294967296 - 0.5) * 0.6; }
  }
  const model = new ExpressionModel();
  const states = new Set();
  for (let offset = 0, time = 0; offset + 4096 <= samples.length; offset += Math.round(rate * 0.1), time += 100) {
    const frame = samples.subarray(offset, offset + 4096);
    const { rms, dbfs } = measureLevel(frame);
    const hz = estimatePitch(frame, rate, rms);
    states.add(model.update({ dbfs, semitone: toSemitone(hz), spectral: measureSpectralBalance(frame, rate), quality: measureVoiceQuality(frame, rate, hz) }, time).state);
  }
  model.reset();
  samples.fill(0);
  return { kind, states: [...states].sort() };
}

const root = fileURLToPath(new URL('../../', import.meta.url));
let fixtures = [];
try {
  const controls = ['silence', 'tone', 'noise'].map(kind => control(kind));
  for (const entry of controls) console.log('Artificial control: ' + entry.kind + ' -> ' + entry.states.join(','));
  if (process.argv.includes('--synthetic-only')) {
    console.log(JSON.stringify({ controls }, null, 2));
  } else {
    fixtures = await publicFixtures();
    const rows = [];
    for (const fixture of fixtures) {
      const audio = decodeWav(fixture.audio);
      const measurement = measureClip(audio.samples, audio.rate);
      audio.samples.fill(0);
      fixture.audio.fill(0);
      const { audio: _dropped, ...provenance } = fixture;
      rows.push({ ...provenance, ...measurement, z: {}, axes: {}, coverage: {} });
      console.log('Measured ' + rows.length + '/' + fixtures.length + ': ' + fixture.speaker + ' ' + fixture.expected +
        ' (voiced ' + Math.round(measurement.voicedRatio * 100) + '%)');
    }
    const speakers = [...new Set(rows.map(row => row.speaker))].sort();
    for (const speaker of speakers) normalise(rows.filter(row => row.speaker === speaker));
    const predictions = PREDICTIONS.map(prediction => {
      const outcomes = speakers.map(speaker => ({ speaker, held: prediction.test(rows.filter(row => row.speaker === speaker)) }));
      return { id: prediction.id, text: prediction.text, held: outcomes.filter(entry => entry.held === true).length,
        speakers: outcomes.length, bySpeaker: outcomes };
    });
    const report = {
      checkedAt: new Date().toISOString(), cpu: cpus()[0]?.model, node: process.version,
      approach: 'Rule-based acoustic axes; no trained weights, no model file, no browser, no ONNX runtime',
      scope: 'Public Japanese corpus, central 3-second windows, per-speaker normalisation; not iPad validation, not a general accuracy estimate, not an emotion classifier',
      dataset, datasetRevision,
      selection: 'First published row per speaker/emotion pair, fixed before measurement; 4 speakers x 6 emotions; center up to 3 seconds; native sample rate, mono mixdown',
      predictionsFixedBeforeRun: PREDICTIONS.map(entry => ({ id: entry.id, text: entry.text })),
      controls, predictions,
      results: rows.map(({ z, ...row }) => row),
      privacy: { networkDuringAnalysis: 'none; corpus fetched before measurement', audioFilesWritten: 0, audioBuffersZeroed: true, userMicrophone: 'not used' },
      caveats: [
        'Six clips per speaker is a very small basis for normalisation',
        'Corpus labels are intended emotions, not measurements of an internal feeling',
        'Central 3 seconds was not re-rated by a listener',
        'Acted corpus speech is not the same as an audition performance',
        'Axes are acoustic descriptions, not emotion categories; this run does not turn them into one',
        'No iPad, no real microphone, no comparison of recording conditions'
      ]
    };
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'docs/emotion-lab-rule-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('\n' + predictions.map(entry => entry.id + ' ' + entry.text + ': ' + entry.held + '/' + entry.speakers).join('\n'));
    console.log(JSON.stringify({ report: 'docs/emotion-lab-rule-results.json', noAudioFilesWritten: true }));
  }
} finally {
  for (const fixture of fixtures) fixture.audio?.fill(0);
}
