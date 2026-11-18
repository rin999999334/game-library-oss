import assert from 'node:assert/strict';
import test from 'node:test';
import { clearArtworkCache, loadGameArtwork, readFrontImages } from '../src/artwork.ts';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
test('parallel image reads each retry the legacy columns when the optional migration is absent', async () => {
  const original = globalThis.fetch; let extended = 0, legacy = 0;
  let releaseSecond!: () => void;
  const firstFallback = new Promise<void>(resolve => { releaseSecond = resolve; });
  clearArtworkCache();
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.searchParams.get('select')?.includes('external_url')) {
      extended++; if (extended === 2) await firstFallback;
      return response({ code: '42703', message: 'external_url does not exist' }, 400);
    }
    legacy++; releaseSecond(); return response([]);
  };
  try {
    assert.deepEqual(await Promise.all([readFrontImages(['one']), readFrontImages(['two'])]), [[], []]);
    assert.equal(extended, 2); assert.equal(legacy, 2);
  } finally { globalThis.fetch = original; clearArtworkCache(); }
});
test('game artwork reads beyond the Supabase default 1000-row limit and shares its cache', async () => {
  const original = globalThis.fetch; const offsets: number[] = [];
  clearArtworkCache();
  globalThis.fetch = async input => {
    const url = new URL(String(input)), offset = Number(url.searchParams.get('offset'));
    offsets.push(offset);
    return response(Array.from({ length: offset === 0 ? 1000 : 1 }, (_, index) => ({ id: `game-${offset + index}`, storage_path: null, external_url: `https://example.com/${offset + index}.png` })));
  };
  try {
    const [left, right] = await Promise.all([loadGameArtwork(), loadGameArtwork()]);
    assert.strictEqual(left, right); assert.equal(Object.keys(left).length, 1001);
    assert.deepEqual(offsets, [0, 1000]);
  } finally { globalThis.fetch = original; clearArtworkCache(); }
});
