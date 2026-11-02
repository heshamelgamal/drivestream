import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

// Tiny JSON-file store: everything lives in memory, writes are debounced and atomic.
export function jsonStore(file, fallback) {
  let data = fallback;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  let timer;
  const flush = () => {
    clearTimeout(timer);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(data));
    renameSync(file + '.tmp', file);
  };
  return {
    get data() { return data; },
    set data(v) { data = v; },
    save() {
      clearTimeout(timer);
      timer = setTimeout(flush, 1000);
    },
    flush,
  };
}

// Run fn over items with at most `limit` in flight.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
