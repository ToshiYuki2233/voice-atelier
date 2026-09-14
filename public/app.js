import { measureLevel, estimatePitch, PitchReadout } from './analysis.js';
import { measureSpectralBalance, measureVoiceQuality, toSemitone } from './spectrum.js';
import { ExpressionModel, LightSmoother, LevelEnvelope, MessageHold, Band } from './expression-model.js';
import { AudioSession } from './audio-session.js';

const element = id => document.getElementById(id);
const startButton = element('start-button');
const stopButton = element('stop-button');
const canvas = element('waveform');
const drawing = canvas.getContext('2d');
const stage = element('voice-stage');
const stageDrawing = stage.getContext('2d');
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let frame = 0, lastMeasurement = 0, mode = 'idle';
const pitchReadout = new PitchReadout();
// Fixed rules, no weights, no learning. Cleared on every stop.
const expression = new ExpressionModel();
// Shape the light only; the numbers on screen stay unsmoothed.
// 900 ms on the hue: a colour has to hold still long enough to be read from the
// other side of a room, not just long enough to be technically correct.
const light = new LightSmoother({ tauMs: 900 });
const envelope = new LevelEnvelope();
// The captions are read from across a room while a performance is going on, so
// they are held still for long enough to actually finish reading: 6 s under the
// stage, 4 s in the measurement panel. Japanese at a glance runs well under ten
// characters a second, and the reader is watching a person, not the screen.
// Hysteresis keeps a value resting on a threshold from flipping the wording.
const stageMessage = new MessageHold({ minMs: 6000 });
const panelMessage = new MessageHold({ minMs: 4000 });
const powerBand = new Band();
const AXES = ['power', 'edge', 'waver', 'spread'];
const IDLE_EXPRESSION = 'マイクを開始すると、数秒後に表示されます。';
// Delivery directions only, so they work with whatever line the performer types.
const cues = ['静かに、ささやくように', '明るく、弾ませて', '強く、言い切る'];
let cueIndex = 0;
const microphone = new AudioSession({
  mediaDevices: navigator.mediaDevices,
  AudioContextClass,
  onInterrupted: () => stop('マイクが中断されました。再開するには「マイクを開始」を押してください。')
});

function draw(samples = null) {
  const width = canvas.width, height = canvas.height;
  drawing.clearRect(0, 0, width, height);
  drawing.strokeStyle = '#294445';
  drawing.lineWidth = 1;
  drawing.beginPath();
  for (let x = 0; x <= width; x += 60) { drawing.moveTo(x, 0); drawing.lineTo(x, height); }
  for (let y = 30; y < height; y += 50) { drawing.moveTo(0, y); drawing.lineTo(width, y); }
  drawing.stroke();
  drawing.strokeStyle = '#dcebb1';
  drawing.lineWidth = 2;
  drawing.beginPath();
  for (let x = 0; x < width; x++) {
    // Fixed scale: never fabricate or normalize a waveform to look louder.
    const sample = samples ? samples[Math.floor(x * samples.length / width)] : 0;
    const y = height / 2 - Math.max(-1, Math.min(1, sample)) * height * 0.44;
    if (x === 0) drawing.moveTo(x, y); else drawing.lineTo(x, y);
  }
  drawing.stroke();
}

// `reading` is one ExpressionModel result, not the module-level model.
function drawStage(dbfs = null, readout = { hz: null, state: 'missing' }, active = false, reading = null, time = 0) {
  const width = stage.width, height = stage.height;
  stageDrawing.clearRect(0, 0, width, height);
  const hasInput = active && dbfs !== null && dbfs > -60;
  const { level: strength, peak } = envelope.update(hasInput ? (dbfs + 60) / 54 : 0, time);
  const position = readout.hz === null ? 0.5 : Math.log(readout.hz / 60) / Math.log(1000 / 60);
  const x = width / 2, y = height * (0.78 - position * 0.56);
  const power = reading?.state === 'ready' ? reading.axes?.power : null;
  const waver = reading?.state === 'ready' ? reading.axes?.waver : null;
  const { hue, presence } = light.update(power, time);
  // Washed out while little is measured, so an uncertain reading looks uncertain,
  // and faded out entirely while there is nothing to read.
  const certainty = reading?.state === 'ready' ? reading.confidence : 0;
  const saturation = Math.round((18 + 62 * certainty) * presence);
  // A trembling voice softens the outline. Kept small: the light is a backdrop
  // for a performance, not an alarm.
  const tremor = Number.isFinite(waver) ? Math.max(0, waver) * 0.05 : 0;
  const radius = 24 + strength * 108;
  const peakRadius = 24 + peak * 108;
  const glowing = strength > 0.01;
  stageDrawing.strokeStyle = '#294445';
  stageDrawing.lineWidth = 1;
  stageDrawing.beginPath();
  for (const offset of [0.22, 0.5, 0.78]) {
    stageDrawing.moveTo(90, height * offset);
    stageDrawing.lineTo(width - 90, height * offset);
  }
  stageDrawing.stroke();
  stageDrawing.fillStyle = '#aabeb7';
  stageDrawing.font = '18px sans-serif';
  stageDrawing.fillText('高い声', 18, 45);
  stageDrawing.fillText('低い声', 18, height - 24);
  if (strength > 0.01) {
    const glow = stageDrawing.createRadialGradient(x, y, 0, x, y, radius * 2);
    glow.addColorStop(0, 'hsla(' + hue + ', ' + saturation + '%, 75%, 0.85)');
    glow.addColorStop(0.4, 'hsla(' + hue + ', ' + saturation + '%, 65%, 0.4)');
    glow.addColorStop(1, 'hsla(' + hue + ', ' + saturation + '%, 65%, 0)');
    stageDrawing.fillStyle = glow;
    stageDrawing.fillRect(0, 0, width, height);
  }
  if (peak > 0.02) {
    // The widest moment of the recent delivery, falling slowly, so one take can
    // be compared with the next by eye.
    stageDrawing.strokeStyle = 'hsla(' + hue + ', ' + saturation + '%, 80%, 0.28)';
    stageDrawing.lineWidth = 2;
    stageDrawing.beginPath();
    stageDrawing.ellipse(x, y, peakRadius * 1.65 * 1.7, peakRadius * 1.65 * 0.64, 0, 0, Math.PI * 2);
    stageDrawing.stroke();
  }
  stageDrawing.strokeStyle = glowing ? 'hsl(' + hue + ', ' + saturation + '%, 78%)' : '#6d8981';
  stageDrawing.lineWidth = glowing ? 3 : 2;
  for (const [index, scale] of [1, 1.3, 1.65].entries()) {
    const shiver = tremor ? 1 + tremor * Math.sin(time / 90 + index * 2.1) : 1;
    stageDrawing.beginPath();
    stageDrawing.ellipse(x, y, radius * scale * 1.7 * shiver, radius * scale * 0.64 * shiver, 0, 0, Math.PI * 2);
    stageDrawing.stroke();
  }
  const band = powerBand.update(power);
  // Short on purpose. The fixed legend under the stage already says what each
  // part of the light means, so this line only reports what is happening now.
  // The full wording, with its limits, stays in the measurement panel.
  const colourNote = Number.isFinite(power)
    ? '勢い：' + (band > 0 ? '強め' : band < 0 ? '弱め' : 'いつもの範囲')
    : '勢い：未計測';
  const caption = !active
    ? 'マイクを開始して、台詞を話してください。'
    : readout.state === 'previous'
      ? '反応中 ／ 高さは直前の値 ／ ' + colourNote
      : readout.state === 'current'
        ? '反応中 ／ ' + colourNote
        : glowing
          ? '音量に反応中 ／ 高さは未検出 ／ ' + colourNote
          : '台詞を話すと光が反応します。';
  element('stage-status').textContent = stageMessage.update(caption, time, !active);
}

// Shows only what was measured. An axis with nothing to measure reads "—", which
// must stay distinct from a measured 0.00, and carries the share of the axis
// actually measured so a quieter reading is visibly a less certain one.
function showExpression(result, time = 0, immediate = false) {
  element('expression-state').textContent = panelMessage.update(result.reason, time, immediate);
  for (const axis of AXES) {
    const value = result.axes?.[axis];
    const share = result.coverage?.[axis];
    const meter = element('axis-' + axis);
    const readable = Number.isFinite(value);
    const percent = Number.isFinite(share) ? Math.round(share * 100) : 0;
    meter.value = readable ? value : 0;
    meter.setAttribute('aria-valuetext', readable ? value.toFixed(2) + '（要素の' + percent + '%を測定中）' : '未計測');
    element('axis-' + axis + '-value').textContent = readable ? (value > 0 ? '+' : '') + value.toFixed(2) : '—';
    element('axis-' + axis + '-coverage').textContent = readable ? percent + '%' : '—';
    meter.closest('li').classList.toggle('unmeasured', !readable);
  }
}

function resetMeasurements() {
  pitchReadout.clear();
  expression.reset();
  light.reset();
  envelope.reset();
  stageMessage.reset();
  panelMessage.reset();
  powerBand.reset();
  showExpression({ reason: IDLE_EXPRESSION, axes: null }, 0, true);
  element('level-value').textContent = '—';
  element('pitch-value').textContent = '—';
  element('level-meter').value = -60;
  element('level-meter').setAttribute('aria-valuetext', '未計測');
  element('pitch-hint').textContent = 'まず「あー」と2秒ほど伸ばしてみてください。';
  element('input-info').textContent = '録音・保存は行いません。停止すると表示も消去します。';
  draw();
  drawStage();
}

function stop(message = '停止しました。音声バッファと表示を消去しました。') {
  microphone.stop();
  cancelAnimationFrame(frame);
  mode = 'idle';
  startButton.disabled = !isSupported();
  stopButton.disabled = true;
  element('session-badge').textContent = '待機中';
  element('session-badge').classList.remove('active');
  element('status').textContent = message;
  element('wave-hint').textContent = '「マイクを開始」で、声の変化がここに現れます。';
  resetMeasurements();
}

function isSupported() {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && !!AudioContextClass;
}

function render(time) {
  if (mode !== 'running' || !microphone.resources) return;
  if (document.hidden) { stop('画面を離れたため、マイクを停止しました。'); return; }
  // Read the current frame at 10 Hz. Retain just one pitch estimate for readability.
  if (time - lastMeasurement >= 100) {
    lastMeasurement = time;
    const { analyser, samples, context } = microphone.resources;
    analyser.getFloatTimeDomainData(samples);
    const { rms, dbfs, peak } = measureLevel(samples);
    const pitch = estimatePitch(samples, context.sampleRate, rms);
    element('level-value').textContent = dbfs === null ? '—' : dbfs < -60 ? '< −60' : dbfs.toFixed(1);
    element('level-meter').value = dbfs === null ? -60 : Math.max(-60, Math.min(0, dbfs));
    element('level-meter').setAttribute('aria-valuetext', dbfs === null ? '無音' : dbfs.toFixed(1) + ' dBFS');
    const readout = pitchReadout.update(pitch, time);
    element('pitch-value').textContent = readout.hz === null ? '—' : Math.round(readout.hz).toString();
    element('pitch-hint').textContent = readout.state === 'current'
      ? 'いま検出した高さです。数字が大きいほど高い声です。'
      : readout.state === 'previous'
        ? '直前の検出値を表示中（最大1.5秒）。現在は検出できていません。'
        : '高さを検出できていません。「あー」と伸ばしてみてください。';
    element('wave-hint').textContent = peak >= 0.99 ? '入力が上限付近です。マイクから少し離れてみてください。' : 'いま届いている音声の波形です。';
    const spectral = measureSpectralBalance(samples, context.sampleRate);
    const quality = measureVoiceQuality(samples, context.sampleRate, pitch);
    const reading = expression.update({ dbfs, semitone: toSemitone(pitch), spectral, quality }, time);
    showExpression(reading, time);
    draw(samples);
    drawStage(dbfs, readout, true, reading, time);
    samples.fill(0);
  }
  frame = requestAnimationFrame(render);
}

const errorMessages = {
  NotAllowedError: 'マイクを使用できません。Safari／ブラウザと端末のマイク許可、HTTPS接続を確認してください。',
  NotFoundError: 'マイクが見つかりません。接続を確認してください。',
  NotReadableError: 'マイクを開けません。ほかのアプリの使用状況を確認してください。',
  OverconstrainedError: 'このマイクの入力設定に対応していません。',
  SecurityError: 'マイクが制限されています。端末設定とHTTPS接続を確認してください。'
};
startButton.addEventListener('click', async () => {
  if (mode !== 'idle') return;
  mode = 'requesting';
  startButton.disabled = true;
  stopButton.disabled = false;
  element('session-badge').textContent = '許可を確認中';
  element('status').textContent = 'マイクの許可を確認しています。取り消す場合は「停止」を押してください。';
  try {
    const resources = await microphone.start();
    if (!resources) return;
    if (document.hidden) { stop('画面を離れたため、マイクを停止しました。'); return; }
    mode = 'running';
    lastMeasurement = 0;
    // Clear the held captions so the first live one appears at once instead of
    // leaving the idle instruction on screen for the length of a hold.
    stageMessage.reset();
    panelMessage.reset();
    powerBand.reset();
    element('session-badge').textContent = 'マイク使用中';
    element('session-badge').classList.add('active');
    element('status').textContent = '声を出してみてください。端末内でリアルタイムに計測しています。';
    const settings = resources.stream.getAudioTracks()[0]?.getSettings() || {};
    const setting = value => value === undefined ? '不明' : value ? '有効' : '無効';
    element('input-info').textContent = '解析レート ' + resources.context.sampleRate.toLocaleString() + ' Hz · 自動ゲイン ' + setting(settings.autoGainControl) + ' · ノイズ抑制 ' + setting(settings.noiseSuppression) + ' · エコー除去 ' + setting(settings.echoCancellation);
    frame = requestAnimationFrame(render);
  } catch (error) {
    stop(errorMessages[error.name] || '音声入力を開始できませんでした。端末の設定を確認し、もう一度お試しください。');
  }
});
stopButton.addEventListener('click', () => stop());
element('cue-button').addEventListener('click', () => {
  cueIndex = (cueIndex + 1) % cues.length;
  element('cue-title').textContent = cues[cueIndex];
  element('cue-number').textContent = (cueIndex + 1) + ' / ' + cues.length;
});
function setPresentation(enabled) {
  document.body.classList.toggle('presentation', enabled);
  element('presentation-button').textContent = enabled ? '通常表示へ' : '本番表示へ';
  element('presentation-button').setAttribute('aria-pressed', String(enabled));
  if (enabled) window.scrollTo(0, 0);
}
element('presentation-button').addEventListener('click', () => setPresentation(!document.body.classList.contains('presentation')));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('presentation')) {
    setPresentation(false);
    element('presentation-button').focus();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode !== 'idle') stop('画面を離れたため、マイクを停止しました。再開には開始ボタンを押してください。');
  if (!document.hidden) checkOffline();
});
window.addEventListener('pagehide', () => stop());
window.addEventListener('pageshow', () => { if (mode === 'idle') resetMeasurements(); checkOffline(); });
draw();
drawStage();
if (!isSupported()) {
  startButton.disabled = true;
  element('status').textContent = window.isSecureContext
    ? 'このブラウザは必要な音声機能に対応していません。Safariなど対応ブラウザで開いてください。'
    : 'マイクにはHTTPSが必要です。Windows単体では http://localhost:5173 を利用できます。';
}

// Only app assets are cached; this module never sends audio or measurements.
let offlineCheck = 0;
async function checkOffline() {
  const sequence = ++offlineCheck;
  const label = element('offline-status');
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    label.textContent = 'オフライン未準備：HTTPSの対応ブラウザで開いてください。';
    return;
  }
  const controller = navigator.serviceWorker.controller;
  if (!controller) {
    label.textContent = 'オフライン未準備：初回のアプリ取得中です。完了しない場合は再読み込みしてください。';
    return;
  }
  const channel = new MessageChannel();
  const timer = setTimeout(() => {
    channel.port1.close();
    if (sequence === offlineCheck) label.textContent = 'オフライン準備を確認できません。接続中に再読み込みしてください。';
  }, 5000);
  channel.port1.onmessage = event => {
    clearTimeout(timer);
    channel.port1.close();
    if (sequence !== offlineCheck) return;
    label.textContent = event.data?.ready
      ? 'オフライン準備完了 · アプリ資産を端末に保存済み'
      : 'オフライン未準備：アプリ資産が不足しています。接続中に再読み込みしてください。';
  };
  controller.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
}
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.addEventListener('controllerchange', checkOffline);
  navigator.serviceWorker.register('./sw.js').then(checkOffline).catch(() => {
    element('offline-status').textContent = 'オフライン準備に失敗しました。通常モードで開き、再読み込みしてください。';
  });
} else checkOffline();
