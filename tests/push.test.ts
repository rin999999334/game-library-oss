import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePush } from '../server/push';

test('public notification API cannot send even with configured private credentials', async () => {
  const savedPublic = process.env.PUSH_VAPID_PUBLIC_KEY, savedPrivate = process.env.PUSH_VAPID_PRIVATE_KEY;
  const originalFetch = globalThis.fetch;
  process.env.PUSH_VAPID_PUBLIC_KEY = 'test-public';
  process.env.PUSH_VAPID_PRIVATE_KEY = 'test-private';
  globalThis.fetch = async () => { throw new Error('Public push API must never send outbound requests'); };
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal((await handlePush(method)).status, 405);
    const result = await handlePush('GET');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { publicKey: 'test-public' });
    assert.ok(!JSON.stringify(result).includes('test-private'));
    delete process.env.PUSH_VAPID_PUBLIC_KEY;
    assert.equal((await handlePush('GET')).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedPublic === undefined) delete process.env.PUSH_VAPID_PUBLIC_KEY; else process.env.PUSH_VAPID_PUBLIC_KEY = savedPublic;
    if (savedPrivate === undefined) delete process.env.PUSH_VAPID_PRIVATE_KEY; else process.env.PUSH_VAPID_PRIVATE_KEY = savedPrivate;
  }
});
