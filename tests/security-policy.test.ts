import test from 'node:test';
import assert from 'node:assert/strict';
import { stableVersionAtLeast, toolchainFindings } from '../scripts/lib/security-policy.mjs';
test('release toolchain policy rejects vulnerable, prerelease, missing and mismatched dependencies', () => {
  const lock = { packages: { 'node_modules/vite': { version: '8.3.8' }, 'node_modules/rolldown': { version: '1.2.17' } } };
  assert.deepEqual(toolchainFindings(lock, { vite: '8.3.8', rolldown: '1.2.17' }), []);
  for (const installed of [{ vite: '8.3.0', rolldown: '1.2.12' }, { vite: '8.3.8-beta.1', rolldown: '1.2.17' }, { vite: '8.3.9', rolldown: '1.2.17' }, { vite: undefined, rolldown: undefined }]) assert.ok(toolchainFindings(lock, installed).length);
  assert.ok(toolchainFindings({ packages: {} }, { vite: '8.3.8', rolldown: '1.2.17' }).length);
  assert.equal(stableVersionAtLeast('8.3.10', [8, 3, 8]), true);
});

test('policy checks the nested Rolldown used by Vite instead of a hoisted unrelated copy', () => {
  const lock = { packages: {
    'node_modules/vite': { version: '8.3.8' },
    'node_modules/rolldown': { version: '1.2.12' },
    'node_modules/vite/node_modules/rolldown': { version: '1.2.19' },
  } };
  const paths = { vite: 'node_modules/vite', rolldown: 'node_modules/vite/node_modules/rolldown' };
  assert.deepEqual(toolchainFindings(lock, { vite: '8.3.8', rolldown: '1.2.19' }, paths), []);
  assert.ok(toolchainFindings(lock, { vite: '8.3.8', rolldown: '1.2.12' }, paths).length);
});
