// Development download only: fixed public model + inference runtime. No audio.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const assetRoot = path.join(root, '.model-lab');
export const revision = '8e0e66145d3a67fb99291f7834d35f073581114b';
export const modelId = 'onnx-community/wav2vec2-emotion-recognition-ONNX';
export const modelHash = '363653a4bce950ddd17026efdabdf6c7a6843e00089bcbaf424c0cdf0b6ebff2';
export const digest = buffer => createHash('sha256').update(buffer).digest('hex');

await mkdir(path.join(assetRoot, 'model'), { recursive: true });
await mkdir(path.join(assetRoot, 'runtime'), { recursive: true });
const manifest = { modelId, revision, runtime: 'onnxruntime-web@1.29.0', files: [] };
for (const name of ['onnx/model_q4.onnx', 'config.json', 'preprocessor_config.json', 'README.md']) {
  const target = path.join(assetRoot, 'model', path.basename(name));
  let data = await readFile(target).catch(() => null);
  if (!data || (name.endsWith('.onnx') && digest(data) !== modelHash)) {
    console.log('Downloading public model asset: ' + name);
    const response = await fetch('https://huggingface.co/' + modelId + '/resolve/' + revision + '/' + name, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Model download failed: ' + response.status);
    data = Buffer.from(await response.arrayBuffer());
    if (name.endsWith('.onnx') && digest(data) !== modelHash) throw new Error('Model SHA-256 mismatch');
    await writeFile(target, data);
  }
  manifest.files.push({ path: 'model/' + path.basename(name), bytes: data.length, sha256: digest(data) });
}
const packageRoot = path.join(root, 'node_modules', 'onnxruntime-web');
const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
if (pkg.version !== '1.29.0') throw new Error('Unexpected runtime version');
// Inference-only build: no ort-training artifact, no remote scripts, no install scripts.
for (const name of ['dist/ort.wasm.min.mjs', 'dist/ort-wasm-simd-threaded.mjs', 'dist/ort-wasm-simd-threaded.wasm']) {
  const target = path.join(assetRoot, 'runtime', path.basename(name));
  await copyFile(path.join(packageRoot, name), target);
  const data = await readFile(target);
  manifest.files.push({ path: 'runtime/' + path.basename(name), bytes: data.length, sha256: digest(data) });
}
for (const name of ['LICENSE', 'ThirdPartyNotices.txt']) {
  const response = await fetch('https://raw.githubusercontent.com/microsoft/onnxruntime/v1.29.0/' + name, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Runtime license download failed: ' + response.status);
  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(assetRoot, 'runtime', name), data);
  manifest.files.push({ path: 'runtime/' + name, bytes: data.length, sha256: digest(data) });
}
await writeFile(path.join(assetRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ modelBytes: manifest.files[0].bytes, modelSHA256: modelHash, runtime: manifest.runtime, result: 'ASSETS_READY' }));
