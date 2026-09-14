import * as ort from '/runtime/ort.wasm.min.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('/runtime/', location.href).href;
ort.env.logLevel = 'fatal';

const config = await (await fetch('/model/config.json')).json();
const processor = await (await fetch('/model/preprocessor_config.json')).json();
if (processor.sampling_rate !== 16000 || processor.do_normalize !== true || processor.return_attention_mask !== false) {
  throw new Error('Unexpected preprocessing contract');
}
const started = performance.now();
const session = await ort.InferenceSession.create('/model/model_q4.onnx', {
  executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 4,
});
if (session.inputNames.length !== 1 || session.inputNames[0] !== 'input_values') throw new Error('Unexpected ONNX inputs');
const loadMs = performance.now() - started;

async function infer(pcm) {
  // Wav2Vec2FeatureExtractor single-utterance normalization, with no padding/mask.
  // Fixed weights only. No training API, optimizer, gradient or parameter update.
  let sum = 0;
  for (const value of pcm) sum += value;
  const mean = sum / pcm.length;
  let variance = 0;
  for (const value of pcm) variance += (value - mean) ** 2;
  const scale = Math.sqrt(variance / pcm.length + 1e-7);
  const values = Float32Array.from(pcm, value => (value - mean) / scale);
  const tensor = new ort.Tensor('float32', values, [1, values.length]);
  const before = performance.now();
  let outputs;
  try {
    outputs = await session.run({ input_values: tensor });
    const logits = Array.from(outputs[session.outputNames[0]].data);
    if (logits.length !== 7 || !logits.every(Number.isFinite)) throw new Error('Invalid classifier output');
    const winner = logits.indexOf(Math.max(...logits));
    return { label: config.id2label[winner], logits, inferenceMs: performance.now() - before };
  } finally {
    tensor.dispose();
    for (const output of Object.values(outputs || {})) output.dispose();
    values.fill(0);
    pcm.fill(0);
  }
}

window.lab = {
  loadMs,
  inputNames: session.inputNames,
  outputNames: session.outputNames,
  labels: config.id2label,
  async synthetic(kind) {
    const pcm = new Float32Array(48000);
    let seed = 42;
    for (let i = 0; i < pcm.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (kind === 'tone') pcm[i] = 0.1 * Math.sin(2 * Math.PI * 220 * i / 16000);
      if (kind === 'noise') pcm[i] = 0.1 * (seed / 4294967296 * 2 - 1);
    }
    return infer(pcm);
  },
  async publicFixture(base64) {
    // Called only by the development runner with published corpus clips.
    // No UI for user audio, microphone, upload or recording.
    const raw = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    base64 = null;
    const context = new OfflineAudioContext(1, 1, 16000);
    let decoded;
    try {
      decoded = await context.decodeAudioData(raw.buffer.slice(0));
      const length = Math.min(decoded.length, 48000);
      const start = Math.floor((decoded.length - length) / 2);
      const pcm = new Float32Array(length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const channel = decoded.getChannelData(c);
        for (let i = 0; i < length; i++) pcm[i] += channel[start + i] / decoded.numberOfChannels;
      }
      const result = await infer(pcm);
      return { ...result, originalSeconds: decoded.duration, windowSeconds: length / 16000 };
    } finally {
      raw.fill(0);
      if (decoded) for (let c = 0; c < decoded.numberOfChannels; c++) decoded.getChannelData(c).fill(0);
    }
  },
  async dispose() { await session.release(); delete window.lab; }
};
document.getElementById('status').textContent = '公開モデルの読み込み完了（検証用・マイクなし）';
