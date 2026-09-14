// Rasterize our own simple vector-like icon; no external artwork or packages.
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  const pixels = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x * 512 / size, sy = y * 512 / size;
      let ink = false;
      for (const [cx, half] of [[144,36],[200,88],[256,132],[312,88],[368,36]]) {
        const dy = Math.max(0, Math.abs(sy - 256) - half);
        if ((sx - cx) ** 2 + dy ** 2 <= 14 ** 2) ink = true;
      }
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      pixels.set(ink ? [220,235,177] : [19,42,43], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(new URL('../public/icons/' + name, import.meta.url), png);
}
