// Fetch published JVNV corpus clips into memory only; never reads local/user audio.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export const dataset = 'asahi417/jvnv-emotional-speech-corpus';
export const datasetRevision = '3b6c3794754e9e514766e898f69604a0f7417218';
const service = 'https://datasets-server.huggingface.co';
const desired = new Set(['angry', 'anger', 'happy', 'sad', 'sadness', 'surprise', 'fear', 'disgust']);

async function getRows(offset, length) {
  const query = new URLSearchParams({ dataset, config: 'default', split: 'test', offset: String(offset), length: String(length) });
  // Backs off on rate limiting. Still fails loudly rather than inventing rows.
  const waits = [2000, 5000, 15000, 30000];
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      const response = await fetch(service + '/rows?' + query, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Public dataset metadata failed: ' + response.status);
      const page = await response.json();
      if (page.partial) throw new Error('Partial public dataset metadata');
      return page;
    } catch (error) {
      if (attempt === waits.length) throw error;
      console.log('Retry public metadata page ' + offset + ' in ' + waits[attempt] / 1000 + 's (' + (attempt + 1) + '/' + waits.length + '): ' + error.message);
      await delay(waits[attempt]);
    }
  }
}

export async function publicFixtures() {
  const selected = new Map();
  // Predetermined selection: first published row for each of 4 speakers x 6 labels.
  // Never choose clips based on predictions. Corpus includes nonverbal vocalizations.
  // Pages are read in row order and stop once all 24 pairs are known: a later row
  // can never replace an earlier first occurrence, so this selects exactly what
  // reading the whole split would select, with far fewer requests on the service.
  let total = Infinity, seen = 0;
  for (let offset = 0; offset < total && selected.size < 24; offset += 100) {
    const page = await getRows(offset, 100);
    total = page.num_rows_total;
    for (const entry of [...page.rows].sort((a, b) => a.row_idx - b.row_idx)) {
      const row = entry.row;
      const key = row.speaker_id + '/' + row.style;
      if (desired.has(row.style) && !selected.has(key)) selected.set(key, entry);
    }
    seen += page.rows.length;
    console.log('Read public corpus metadata: ' + seen + '/' + total + ' rows, ' + selected.size + '/24 pairs found');
    if (selected.size < 24) await delay(400);
  }
  if (selected.size !== 24) throw new Error('Expected 24 speaker/emotion pairs, found ' + selected.size);
  const entries = [...selected.values()];
  const fixtures = [];
  try {
    for (let start = 0; start < entries.length; start += 2) {
      if (start) await delay(300);
      const batch = await Promise.all(entries.slice(start, start + 2).map(async entry => {
        const url = new URL(entry.row.audio[0].src);
        if (url.origin !== service || !url.pathname.includes('/--/' + datasetRevision + '/--/')) throw new Error('Unexpected corpus source/revision');
        const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
        if (!response.ok) throw new Error('Public corpus audio fetch failed: ' + response.status);
        const audio = Buffer.from(await response.arrayBuffer());
        if (audio.length > 10000000 || audio.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Unexpected public fixture format');
        return { id: 'jvnv-row-' + entry.row_idx, row: entry.row_idx, speaker: entry.row.speaker_id,
          expected: ({ anger: 'angry', sadness: 'sad', fear: 'fearful', surprise: 'surprised' })[entry.row.style] || entry.row.style,
          session: entry.row.session, sha256: createHash('sha256').update(audio).digest('hex'), audio };
      }));
      fixtures.push(...batch);
      console.log('Public corpus clips in memory: ' + fixtures.length + '/24 (no audio files written)');
    }
    return fixtures;
  } catch (error) {
    for (const fixture of fixtures) fixture.audio.fill(0);
    throw error;
  }
}
