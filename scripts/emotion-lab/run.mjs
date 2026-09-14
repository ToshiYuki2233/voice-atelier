// Standalone developer test; production app is not modified or given a model.
// Only published corpus fixtures and deterministic artificial signals are accepted.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { publicFixtures, dataset, datasetRevision } from './fixtures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const labRoot = path.join(root, '.model-lab');
const manifest = JSON.parse(await readFile(path.join(labRoot, 'manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  const data = await readFile(path.join(labRoot, entry.path));
  assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, 'Asset hash: ' + entry.path);
}
const routes = new Map([
  ['/', { file: path.join(root, 'scripts/emotion-lab/index.html'), type: 'text/html; charset=utf-8' }],
  ['/lab.mjs', { file: path.join(root, 'scripts/emotion-lab/lab.mjs'), type: 'text/javascript; charset=utf-8' }],
  ...manifest.files.map(entry => ['/' + entry.path, { file: path.join(labRoot, entry.path),
    type: entry.path.endsWith('.mjs') ? 'text/javascript' : entry.path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' }])
]);
let serverGets = 0, serverRejected = 0;
const server = createServer(async (request, response) => {
  const route = routes.get(request.url);
  const headers = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'microphone=(), camera=(), geolocation=()',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'
  };
  if (request.method !== 'GET' || !route) {
    serverRejected++;
    response.writeHead(404, headers); response.end(); return;
  }
  serverGets++;
  try { const bytes = await readFile(route.file); response.writeHead(200, { ...headers, 'Content-Type': route.type }); response.end(bytes); }
  catch { response.writeHead(500, headers); response.end(); }
});

let fixtures = [], browser, socket, nextId = 0;
const events = [], pending = new Map();
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 60000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const until = async (predicate, label) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(150);
  }
  throw new Error('Timed out: ' + label);
};
try {
  if (!process.argv.includes('--synthetic-only')) fixtures = await publicFixtures();
  const candidates = [process.env.VOICE_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw new Error('Chrome/Edge not found');
  await mkdir(path.join(root, '.test-browser'), { recursive: true });
  const profile = await mkdtemp(path.join(root, '.test-browser/emotion-'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-extensions', '--deny-permission-prompts', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port;
  await until(async () => {
    const value = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    port = Number(value.split('\n')[0]); return !!port;
  }, 'isolated browser startup');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) { events.push(message); return; }
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  // Prevent every page request outside the static allowlist, even before offline mode.
  await command('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  let blockedRequests = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { request, requestId } = message.params;
    const url = new URL(request.url);
    const allowed = url.origin === origin && routes.has(url.pathname) && !url.search && request.method === 'GET' && !request.hasPostData;
    if (!allowed) blockedRequests++;
    command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  // Monitor attempted persistence. Read-only post-test checks do not call these methods.
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__persistenceAttempts = [];
    for (const [object, method] of [[Storage.prototype,'setItem'],[IDBFactory.prototype,'open'],[CacheStorage.prototype,'open'],[navigator.mediaDevices,'getUserMedia']]) {
      object[method] = function() { window.__persistenceAttempts.push(method); throw new Error('Forbidden in model lab: ' + method); };
    }
  ` });
  console.log('Loading actual ONNX model in browser (WASM CPU, one thread)...');
  await command('Page.navigate', { url: origin + '/' });
  await until(async () => {
    const errors = events.filter(event => event.method === 'Runtime.exceptionThrown');
    if (errors.length) throw new Error(errors[0].params.exceptionDetails.exception?.description || 'Browser module failed');
    return evaluate('Boolean(window.lab)');
  }, 'ONNX session');
  const details = await evaluate('({loadMs:lab.loadMs,inputNames:lab.inputNames,outputNames:lab.outputNames,labels:lab.labels})');
  // Close network at the browser network layer before any inference, including fixtures.
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const beforeRequests = events.filter(event => event.method === 'Network.requestWillBeSent').length;
  const controls = [];
  for (const kind of ['silence', 'tone', 'noise', 'tone']) {
    const result = await evaluate('lab.synthetic(' + JSON.stringify(kind) + ')');
    controls.push({ kind, ...result });
    console.log('Artificial control completed: ' + kind);
  }
  assert.deepEqual(controls[1].logits, controls[3].logits, 'Repeated input must be deterministic');
  const results = [];
  for (const fixture of fixtures) {
    // CDP is local developer control, not an app upload API. Only public corpus audio.
    const result = await evaluate('lab.publicFixture(' + JSON.stringify(fixture.audio.toString('base64')) + ')');
    fixture.audio.fill(0);
    const { audio, ...provenance } = fixture;
    results.push({ ...provenance, ...result, match: result.label === fixture.expected });
    console.log('Public fixture ' + results.length + '/' + fixtures.length + ': ' + fixture.speaker + ' ' + fixture.expected + ' -> ' + result.label);
  }
  const storage = await evaluate('(async()=>({attempts:window.__persistenceAttempts,local:localStorage.length,session:sessionStorage.length,cookie:document.cookie,databases:await indexedDB.databases(),caches:await caches.keys(),workers:(await navigator.serviceWorker.getRegistrations()).length}))()');
  assert.deepEqual(storage, { attempts: [], local: 0, session: 0, cookie: '', databases: [], caches: [], workers: 0 });
  assert.equal(blockedRequests, 0);
  assert.equal(events.filter(event => event.method === 'Network.requestWillBeSent').length, beforeRequests, 'No requests during offline inference');
  assert.equal(events.filter(event => event.method === 'Network.webSocketCreated').length, 0);
  assert.equal(events.filter(event => event.method === 'Runtime.exceptionThrown').length, 0);
  const requests = events.filter(event => event.method === 'Network.requestWillBeSent').map(event => event.params.request);
  assert.ok(requests.every(request => new URL(request.url).origin === origin && request.method === 'GET' && !request.hasPostData));
  const version = await command('Browser.getVersion');
  const report = {
    checkedAt: new Date().toISOString(), browser: version.product, cpu: cpus()[0]?.model,
    scope: 'Public Japanese corpus, central 3-second windows; no user microphone; not iPad validation or general accuracy',
    model: manifest, session: details, controls, dataset, datasetRevision,
    selection: 'First published row per speaker/emotion pair, fixed before inference; 4 speakers x 6 emotions; center up to 3 seconds; 16 kHz mono with browser resampling and Wav2Vec2 normalization',
    results, matches: results.filter(row => row.match).length, total: results.length,
    privacy: { pageNetwork: 'offline during all inference', requestsDuringInference: 0, initialRequests: requests.length, blockedRequests, serverGets, serverRejected, storage, microphone: 'denied by Permissions-Policy; not requested', audioFilesWritten: 0 },
    result: 'TECHNICAL_CHECKS_PASS', caveats: ['Small preselected sample; not a representative accuracy estimate', 'Does not validate unseen microphones, rooms, quiet speech, or iPad', 'Dataset intended emotion is not an objective measurement of an internal feeling', 'Model card says neutral; config index 1 actually says calm', 'No native/PyTorch numerical equivalence verification yet', 'No claim of a comprehensive browser/OS/library security audit']
  };
  await mkdir(path.join(root, 'docs'), { recursive: true });
  const reportPath = fixtures.length ? 'docs/emotion-lab-results.json' : 'docs/emotion-lab-controls.json';
  await writeFile(path.join(root, reportPath), JSON.stringify(report, null, 2) + '\n');
  await evaluate('lab.dispose()');
  console.log(JSON.stringify({ report: reportPath, result: report.result, matches: report.matches, total: report.total, modelLoadMs: details.loadMs, noAudioFilesWritten: true }));
} finally {
  for (const fixture of fixtures) fixture.audio.fill(0);
  if (socket?.readyState === WebSocket.OPEN) { await command('Browser.close').catch(() => {}); socket.close(); }
  browser?.kill();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
