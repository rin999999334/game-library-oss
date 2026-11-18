import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../scripts/audit-public.mjs', import.meta.url));
test('publication scanner rejects forbidden files and credentials without disclosing values, including NUL-separated data', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'public-audit-test-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const scan = () => {
    try { return { status: 0, output: execFileSync(process.execPath, [script], { cwd, encoding: 'utf8' }) }; }
    catch (error) { const result = error as { status: number; stdout: string }; return { status: result.status, output: result.stdout }; }
  };
  try {
    git('init', '-q');
    writeFileSync(join(cwd, 'README.md'), 'A harmless contribution guide.');
    git('add', 'README.md');
    assert.equal(scan().status, 0);
    const credential = 'gh' + 'p_' + 'x'.repeat(36);
    writeFileSync(join(cwd, 'config.txt'), Buffer.from(credential.split('').join('\0')));
    writeFileSync(join(cwd, '.env.local'), 'PRIVATE_VALUE=local-only-test-value');
    git('add', 'config.txt', '.env.local');
    const result = scan();
    assert.notEqual(result.status, 0);
    const findings = JSON.parse(result.output).findings as { path: string }[];
    assert.ok(findings.some(finding => finding.path === 'config.txt'));
    assert.ok(findings.some(finding => finding.path === '.env.local'));
    assert.ok(!result.output.includes(credential));
    assert.ok(!result.output.includes('local-only-test-value'));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
