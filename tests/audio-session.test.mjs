import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSession } from '../public/audio-session.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class Track extends EventTarget {
  readyState = 'live';
  muted = false;
  stop() { this.readyState = 'ended'; }
}
function stream() { const track = new Track(); return { track, getTracks: () => [track], getAudioTracks: () => [track] }; }
class Node {
  disconnected = false;
  gain = { value: 1 };
  connect() {}
  disconnect() { this.disconnected = true; }
}
class Context {
  state = 'suspended';
  destination = {};
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createMediaStreamSource() { return new Node(); }
  createAnalyser() { return new Node(); }
  createGain() { return new Node(); }
}
function session(getUserMedia, extra = {}) {
  return new AudioSession({ mediaDevices: { getUserMedia }, AudioContextClass: Context, ...extra });
}
test('stop releases tracks, nodes, context and clears in-memory samples', async () => {
  const input = stream(), mic = session(async () => input);
  const resources = await mic.start();
  resources.samples.fill(0.4);
  mic.stop();
  assert.equal(input.track.readyState, 'ended');
  assert.equal(resources.context.state, 'closed');
  assert.equal(resources.source.disconnected, true);
  assert.equal(resources.analyser.disconnected, true);
  assert.equal(resources.gain.disconnected, true);
  assert.equal(resources.samples.some(x => x !== 0), false);
  assert.equal(mic.resources, null);
});
test('a late permission grant after cancellation immediately stops its track', async () => {
  const pending = deferred(), input = stream(), mic = session(() => pending.promise);
  const started = mic.start();
  const context = mic.resources.context;
  mic.stop();
  pending.resolve(input);
  assert.equal(await started, null);
  assert.equal(input.track.readyState, 'ended');
  assert.equal(context.state, 'closed');
});
test('late old grant cannot replace a newer session', async () => {
  const old = deferred(), oldStream = stream(), next = stream();
  let count = 0;
  const mic = session(() => ++count === 1 ? old.promise : Promise.resolve(next));
  const first = mic.start();
  mic.stop();
  const second = await mic.start();
  old.resolve(oldStream);
  assert.equal(await first, null);
  assert.equal(oldStream.track.readyState, 'ended');
  assert.equal(mic.resources, second);
  assert.equal(next.track.readyState, 'live');
  mic.stop();
});
test('permission refusal releases the AudioContext and allows retry', async () => {
  const pending = deferred(), input = stream();
  let first = true;
  const mic = session(() => { if (first) { first = false; return pending.promise; } return Promise.resolve(input); });
  const attempt = mic.start(), context = mic.resources.context;
  pending.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  await assert.rejects(attempt, { name: 'NotAllowedError' });
  assert.equal(context.state, 'closed');
  assert.equal(mic.resources, null);
  assert.ok(await mic.start());
  mic.stop();
});
test('track mute, track end and context interruption stop input without auto-resume', async () => {
  for (const type of ['mute', 'ended', 'context']) {
    let interrupted = 0;
    const input = stream(), mic = session(async () => input, { onInterrupted: () => interrupted++ });
    const resources = await mic.start();
    if (type === 'context') { resources.context.state = 'interrupted'; resources.context.onstatechange(); }
    else input.track.dispatchEvent(new Event(type));
    assert.equal(interrupted, 1);
    assert.equal(mic.resources, null);
    assert.equal(input.track.readyState, 'ended');
  }
});
