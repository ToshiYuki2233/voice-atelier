import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function harness({ failInstall = false } = {}) {
  const events = {}, entries = new Map(), calls = [];
  const cache = {
    async addAll(requests) {
      if (failInstall) throw new Error('offline during install');
      for (const request of requests) entries.set(request.url, new Response('asset'));
    },
    async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.clone(); },
    async put(request, response) { entries.set(request.url, response); }
  };
  const context = {
    URL, Request, Response, Promise,
    self: { registration: { scope: 'https://example.test/' }, clients: { claim: async () => {} }, addEventListener: (name, fn) => { events[name] = fn; } },
    caches: { open: async () => cache, keys: async () => ['unrelated-cache', 'voice-atelier-old'], delete: async key => calls.push(key) },
    fetch: async request => { calls.push(request.url); throw new Error('network offline'); }
  };
  vm.runInNewContext(source, context);
  const waitEvent = async name => {
    let operation;
    events[name]({ waitUntil: promise => { operation = promise; } });
    await operation;
  };
  const request = async (url, method = 'GET') => {
    let result;
    events.fetch({ request: new Request(url, { method }), respondWith: promise => { result = promise; } });
    return await result;
  };
  const ready = async () => {
    let result, operation;
    events.message({ data: { type: 'CHECK_OFFLINE' }, ports: [{ postMessage: value => { result = value.ready; } }], waitUntil: promise => { operation = promise; } });
    await operation;
    return result;
  };
  return { entries, calls, waitEvent, request, ready };
}
test('complete app shell loads offline; no external or arbitrary request is forwarded', async () => {
  const h = harness();
  await h.waitEvent('install');
  assert.equal(await h.ready(), true);
  assert.equal((await h.request('https://example.test/')).status, 200);
  for (const [url, method] of [['https://outside.test/', 'GET'], ['https://example.test/?audio=x', 'GET'], ['https://example.test/', 'POST']]) {
    assert.equal((await h.request(url, method)).status, 403);
  }
  assert.equal(h.calls.length, 0);
  await h.waitEvent('activate');
  assert.deepEqual(h.calls, ['voice-atelier-old']);
});
test('partial or failed caches never report ready; missing offline asset fails clearly', async () => {
  const h = harness();
  await h.waitEvent('install');
  h.entries.delete('https://example.test/app.js');
  assert.equal(await h.ready(), false);
  assert.equal((await h.request('https://example.test/app.js')).status, 503);
  const failed = harness({ failInstall: true });
  await assert.rejects(failed.waitEvent('install'));
  assert.equal(await failed.ready(), false);
});
