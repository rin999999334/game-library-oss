import { execFileSync, spawnSync } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const checks = [
  ['node', ['scripts/check-toolchain.mjs']],
  ['node', ['scripts/audit-public.mjs']],
  [npm, ['audit', '--audit-level=low', '--fetch-retries=0', '--fetch-timeout=15000']],
  ['git', ['diff', '--exit-code', '--quiet']],
];
let failed = false;
if (execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z']).length) {
  console.error('未追跡のファイルがあります。公開候補に含めるか除外してから検査してください。');
  failed = true;
}
for (const [command, args] of checks) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 60000 });
  if (result.error || result.status !== 0) {
    console.error(`検査未完了: ${command} ${args.join(' ')}`);
    failed = true;
  }
}
if (failed) { console.error('セキュリティ検査に合格していないため、公開処理へ進めません。'); process.exitCode = 1; }
