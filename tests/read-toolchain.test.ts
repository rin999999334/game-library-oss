import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readToolchain } from '../scripts/lib/read-toolchain.mjs';
test('installed version detection follows Node resolution from Vite to its nested dependency', () => {
  const root = mkdtempSync(join(tmpdir(), 'toolchain-resolution-'));
  try {
    writeFileSync(join(root, 'package.json'), '{}');
    for (const [path, version] of [['node_modules/vite', '8.3.8'], ['node_modules/rolldown', '1.2.12'], ['node_modules/vite/node_modules/rolldown', '1.2.19']]) {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, 'package.json'), JSON.stringify({ version }));
    }
    const result = readToolchain(root);
    assert.equal(result.installed.rolldown, '1.2.19');
    assert.equal(result.paths.rolldown, 'node_modules/vite/node_modules/rolldown');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
