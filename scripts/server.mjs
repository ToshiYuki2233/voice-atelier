import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const routes = new Map([
  ['/', 'text/html; charset=utf-8'], ['/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'], ['/analysis.js', 'text/javascript; charset=utf-8'],
  ['/spectrum.js', 'text/javascript; charset=utf-8'], ['/expression-model.js', 'text/javascript; charset=utf-8'],
  ['/audio-session.js', 'text/javascript; charset=utf-8'], ['/sw.js', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'], ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['/icons/icon.svg', 'image/svg+xml'], ['/icons/icon-192.png', 'image/png'],
  ['/icons/icon-512.png', 'image/png'], ['/icons/apple-touch-icon.png', 'image/png']
]);
export const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export async function handler(request, response) {
  const headers = {
    'Content-Security-Policy': csp,
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache'
  };
  // No API, upload, access logger, cookies, or directory listing.
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }
  const route = request.url;
  if (!routes.has(route)) {
    response.writeHead(404, headers);
    response.end('Not found');
    return;
  }
  try {
    const content = await readFile(path.join(publicRoot, route === '/' ? 'index.html' : route.slice(1)));
    response.writeHead(200, { ...headers, 'Content-Type': routes.get(route) });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500, headers);
    response.end('App asset unavailable');
  }
}

export async function createServer({ tls = false } = {}) {
  if (!tls) return http.createServer(handler);
  const [key, cert] = await Promise.all([
    readFile(new URL('../.certs/dev-key.pem', import.meta.url)),
    readFile(new URL('../.certs/dev.pem', import.meta.url))
  ]);
  return https.createServer({ key, cert, minVersion: 'TLSv1.2' }, handler);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const tls = process.argv.includes('--https');
  const host = tls ? '0.0.0.0' : '127.0.0.1';
  const port = tls ? 5174 : 5173;
  try {
    const server = await createServer({ tls });
    server.on('error', () => {
      console.error('Server could not start. Check port availability.');
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      console.log('Voice Atelier: ' + (tls ? 'https://localhost:5174 (LAN HTTPS enabled)' : 'http://localhost:5173'));
      console.log('Static assets only. No access logs. Ctrl+C to stop.');
    });
  } catch {
    console.error('HTTPS needs .certs/dev.pem and .certs/dev-key.pem. See README.md.');
    process.exitCode = 1;
  }
}
