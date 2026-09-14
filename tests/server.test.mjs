import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/server.mjs';
test('server exposes only app assets, rejects upload and sets privacy headers', async () => {
  const server = await createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(page.headers.get('permissions-policy'), /microphone=\(self\)/);
    assert.equal(page.headers.get('set-cookie'), null);
    assert.match(await page.text(), /感情分類モデル：未導入/);
    for (const route of ['/AGENTS.md', '/.certs/dev-key.pem', '/api', '/?audio=test', '/icons/../package.json']) {
      assert.equal((await fetch(origin + route)).status, 404);
    }
    assert.equal((await fetch(origin, { method: 'POST', body: 'synthetic-test' })).status, 405);
    for (const route of ['/app.js', '/analysis.js', '/audio-session.js', '/sw.js', '/styles.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200, route);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
