import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBlogFavicons, loadGameFavicons } from '../src/blog-favicon';

test('many home icons share one retryable request, independently from link icons, and reject non-local images', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  let fail = true;
  globalThis.fetch = async input => {
    const path = String(input); calls.push(path);
    if (path === '/game-blog-favicons.json' && fail) { fail = false; throw new Error('Disconnected'); }
    return new Response(JSON.stringify({
      good: { src: '/blog-favicons/0123456789abcdef01234567.png' },
      remote: { src: 'https://example.com/track.png' },
      malformed: null,
    }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await loadGameFavicons(), {});
    const home = await Promise.all(Array.from({ length: 84 }, () => loadGameFavicons()));
    const links = await Promise.all(Array.from({ length: 20 }, () => loadBlogFavicons()));
    assert.ok(home.every(value => value === home[0]));
    assert.ok(links.every(value => value === links[0]));
    assert.deepEqual(Object.keys(home[0]), ['good']);
    assert.deepEqual(calls, ['/game-blog-favicons.json', '/game-blog-favicons.json', '/blog-favicons.json']);
  } finally { globalThis.fetch = original; }
});
