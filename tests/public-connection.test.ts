import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicKey } from '../src/public-connection';
const token = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
test('privileged Supabase keys cannot enter browser clients and never appear in errors', () => {
  for (const value of ['sb_secret_' + 'x'.repeat(32), token('service_role'), token('authenticated'), 'a.invalid.b', ' sb_secret_' + 'x'.repeat(32), token('service_role') + ' ']) {
    assert.throws(() => assertPublicKey(value), error => error instanceof Error && !error.message.includes(value));
  }
  assert.doesNotThrow(() => assertPublicKey(token('anon')));
  assert.doesNotThrow(() => assertPublicKey('sb_publishable_test'));
  assert.doesNotThrow(() => assertPublicKey(undefined));
});
