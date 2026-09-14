// Windows Chromium smoke test using CDP; fake device only, no user's microphone.
// Writes an isolated browser profile and an idle-screen preview; never saves audio.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from './server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidates = [process.env.VOICE_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error('Chrome/Edge not found. Set VOICE_TEST_BROWSER to its executable path.');
const profileRoot = path.join(root, '.test-browser');
await mkdir(profileRoot, { recursive: true });
const profile = await mkdtemp(path.join(profileRoot, 'run-'));
const server = await createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = spawn(executable, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let socket, nextId = 0;
const pending = new Map(), events = [], checks = [];
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const until = async (predicate, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch {}
    await delay(80);
  }
  throw new Error('Timed out: ' + label);
};
const click = async id => {
  const point = await evaluate("(() => { const el=document.getElementById(" + JSON.stringify(id) + "); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
};
const AXIS_VALUES = "['power','edge','waver','spread'].map(name => document.getElementById('axis-' + name + '-value').textContent)";
const stopped = () => evaluate("document.getElementById('stop-button').disabled && window.__testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')) && document.getElementById('level-value').textContent === '—' && document.getElementById('pitch-value').textContent === '—'");
try {
  let port;
  await until(async () => {
    const text = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
    port = Number(text.split('\n')[0]); return !!port;
  }, 'browser startup');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const target = targets.find(item => item.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    } else events.push(message);
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Network.enable');
  const version = await command('Browser.getVersion');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: [
    'window.__testStreams = []; window.__testDocument = crypto.randomUUID();',
    'const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);',
    'navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await original(...args); window.__testStreams.push(stream); return stream; };'
  ].join('\n') });
  await command('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin + '/' });
  await until(() => evaluate("document.getElementById('offline-status')?.textContent.includes('オフライン準備完了')"), 'offline cache ready');
  assert.equal(await evaluate("document.getElementById('level-value').textContent"), '—');
  assert.equal(await evaluate("document.getElementById('model-title').textContent"), '感情分類モデル：未導入');
  checks.push('initial state and verified offline cache');
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(root, 'docs', 'preview.png'), Buffer.from(screenshot.data, 'base64'));
  await click('presentation-button');
  assert.equal(await evaluate("document.body.classList.contains('presentation') && document.getElementById('presentation-button').getAttribute('aria-pressed') === 'true'"), true);
  const presentationScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(root, 'docs', 'presentation.png'), Buffer.from(presentationScreenshot.data, 'base64'));
  await click('cue-button');
  assert.equal(await evaluate("document.getElementById('cue-title').textContent"), '明るく、弾ませて');
  await click('cue-button');
  await click('cue-button');
  assert.equal(await evaluate("document.getElementById('cue-title').textContent"), '静かに、ささやくように');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await evaluate("document.body.classList.contains('presentation')"), false);
  checks.push('presentation view, manual cues and Escape return');
  // Expanded too, so the four-axis panel is measured rather than left collapsed.
  await evaluate("document.querySelector('.signal-details').open = true; true");
  for (const width of [1180, 820, 390]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    assert.equal(await evaluate("document.querySelector('.axis-list').scrollWidth <= document.querySelector('.axis-list').clientWidth"), true);
    await click('presentation-button');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    await click('presentation-button');
  }
  checks.push('no horizontal overflow at 1180, 820, 390 CSS pixels with the measurement panel open');
  await evaluate("window.__testIdleStage = document.getElementById('voice-stage').toDataURL()");
  await click('start-button');
  await until(() => evaluate("document.getElementById('session-badge').textContent === 'マイク使用中' && document.getElementById('level-value').textContent !== '—'"), 'fake microphone measurement');
  await until(() => evaluate("document.getElementById('voice-stage').toDataURL() !== window.__testIdleStage"), 'stage responds to measured input');
  // The Chromium fake device is loud but not periodic. The rule-based model must
  // say so rather than produce an axis reading, which is the behaviour that a
  // classifier lacked when it labelled silence and noise as an emotion.
  const refusals = new Set();
  for (let poll = 0; poll < 40; poll++) {
    assert.deepEqual(await evaluate(AXIS_VALUES), ['—', '—', '—', '—'], 'axes appeared for aperiodic input');
    refusals.add(await evaluate("document.getElementById('expression-state').textContent"));
    await delay(150);
  }
  assert.ok(refusals.size > 0 && [...refusals].every(text => /静かすぎます|周期的な音/.test(text)),
    'expected only stated reasons, got ' + JSON.stringify([...refusals]));
  checks.push('6 s of loud aperiodic input never yields an axis reading; states seen: ' + [...refusals].length);
  await click('stop-button');
  await until(stopped, 'track release and reset');
  assert.equal(await evaluate("document.getElementById('voice-stage').toDataURL() === window.__testIdleStage"), true);
  checks.push('stage reacts to fake microphone signal and resets to idle on stop');
  checks.push('real Web Audio graph with Chromium fake microphone, stop and clear');
  // A synthetic periodic tone exercises the voiced path, which the fake device
  // cannot reach. This is a generated test signal, not a recorded voice, and it
  // is replaced by the real device again before the remaining checks.
  await evaluate([
    "window.__testRealMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);",
    "navigator.mediaDevices.getUserMedia = async () => {",
    "  const context = new AudioContext();",
    "  const tone = context.createOscillator(); tone.type = 'sawtooth'; tone.frequency.value = 196;",
    "  const vibrato = context.createOscillator(); vibrato.frequency.value = 0.8;",
    "  const depth = context.createGain(); depth.gain.value = 14;",
    "  vibrato.connect(depth); depth.connect(tone.frequency);",
    "  const level = context.createGain(); level.gain.value = 0.28;",
    "  const swell = context.createOscillator(); swell.frequency.value = 0.5;",
    "  const swellDepth = context.createGain(); swellDepth.gain.value = 0.12;",
    "  swell.connect(swellDepth); swellDepth.connect(level.gain);",
    "  const destination = context.createMediaStreamDestination();",
    "  tone.connect(level); level.connect(destination);",
    "  tone.start(); vibrato.start(); swell.start();",
    "  window.__testStreams.push(destination.stream);",
    "  return destination.stream;",
    "};",
    "true"
  ].join('\n'));
  await click('start-button');
  await until(() => evaluate("document.getElementById('pitch-value').textContent !== '—'"), 'pitch from the synthetic tone');
  await until(() => evaluate("document.getElementById('axis-power-value').textContent !== '—'"), 'expression axes from the synthetic tone');
  const axes = await evaluate(AXIS_VALUES);
  assert.ok(axes.every(value => /^[+-]?\d\.\d\d$/.test(value)), 'expected numeric axes, got ' + JSON.stringify(axes));
  await click('stop-button');
  await until(stopped, 'synthetic tone release');
  assert.deepEqual(await evaluate(AXIS_VALUES), ['—', '—', '—', '—']);
  await evaluate("navigator.mediaDevices.getUserMedia = window.__testRealMedia; true");
  checks.push('voiced path on a synthetic tone gives all four axes (' + axes.join(' / ') + ') and clears on stop');
  for (let i = 0; i < 3; i++) {
    await click('start-button');
    await until(() => evaluate("document.getElementById('session-badge').textContent === 'マイク使用中'"), 'restart');
    await click('stop-button');
    await until(stopped, 'repeated stop');
  }
  checks.push('three additional start/stop cycles');
  await click('start-button');
  await until(() => evaluate("document.getElementById('session-badge').textContent === 'マイク使用中'"), 'before background');
  await evaluate("Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))");
  await until(stopped, 'background stop');
  await evaluate("delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))");
  assert.equal(await stopped(), true);
  checks.push('visibilitychange stops input and does not auto-resume (simulated event)');
  await evaluate("window.__originalGUM = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }");
  await click('start-button');
  await until(() => evaluate("document.getElementById('status').textContent.includes('マイクを使用できません') && !document.getElementById('start-button').disabled"), 'permission refusal');
  await evaluate('navigator.mediaDevices.getUserMedia = window.__originalGUM');
  checks.push('permission refusal UI (simulated rejection)');
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const previousDocument = await evaluate('window.__testDocument');
  await command('Page.reload');
  await until(() => evaluate('window.__testDocument && window.__testDocument !== ' + JSON.stringify(previousDocument)), 'new offline document');
  await until(() => evaluate("document.getElementById('offline-status')?.textContent.includes('オフライン準備完了')"), 'offline reload from service worker');
  await click('start-button');
  await until(() => evaluate("document.getElementById('session-badge').textContent === 'マイク使用中'"), 'offline microphone');
  await click('stop-button');
  await until(stopped, 'offline stop');
  checks.push('network-offline reload and fake microphone with HTTP cache disabled');
  assert.equal(await evaluate("localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''"), true);
  assert.deepEqual(await evaluate('indexedDB.databases()'), []);
  const cached = await evaluate("(async () => { const result=[]; for(const key of await caches.keys()) { const cache=await caches.open(key); result.push(...(await cache.keys()).map(r=>new URL(r.url).pathname)); } return result; })()");
  assert.equal(cached.length, 13);
  checks.push('no cookies, local/session storage or IndexedDB; cache has 13 static assets');
  const requests = events.filter(item => item.method === 'Network.requestWillBeSent').map(item => item.params.request);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => request.url.startsWith(origin + '/') && request.method === 'GET' && !request.hasPostData));
  assert.equal(events.filter(item => item.method === 'Network.webSocketCreated').length, 0);
  assert.equal(events.filter(item => item.method === 'Runtime.exceptionThrown').length, 0);
  checks.push('observed page requests are local GET only; no page WebSocket or uncaught JS error');
  console.log(JSON.stringify({ browser: version.product, checks, result: 'PASS', screenshot: 'docs/preview.png' }, null, 2));
} catch (error) {
  console.error('Browser diagnostic:', await evaluate("({status:document.getElementById('status')?.textContent,badge:document.getElementById('session-badge')?.textContent,hidden:document.hidden,level:document.getElementById('level-value')?.textContent,pitch:document.getElementById('pitch-value')?.textContent,expression:document.getElementById('expression-state')?.textContent,axes:['power','edge','waver','spread'].map(n=>document.getElementById('axis-'+n+'-value')?.textContent),tracks:window.__testStreams?.map(s=>s.getTracks().map(t=>t.readyState))})").catch(() => 'Page unavailable'));
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command('Browser.close').catch(() => {});
    socket.close();
  }
  browser.kill();
  await new Promise(resolve => server.close(resolve));
}
