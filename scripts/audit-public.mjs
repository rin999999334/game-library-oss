import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Inspect the staged snapshot, not unrelated files in the workspace.
// Values are never printed, even when a match is found.
const paths = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
if (!paths.length) throw new Error('検査対象がありません。公開候補をgit addしてから実行してください。');
const findings = [];
const localSecrets = [];
for (const file of ['.env', '.env.local']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || !/SECRET|PRIVATE|PASSWORD|TOKEN|SERVICE_ROLE/i.test(match[1])) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (value.length > 8) localSecrets.push(Buffer.from(value));
  }
}
const forbidden = /(^|\/)(?:\.env(?!\.example$)[^/]*|\.vercel|\.local-backups|node_modules|dist|dist-demo)(?:\/|$)|^docs\/release\/|\.(?:pem|p12|pfx|key|sqlite|sqlite3|db|dump|zip|tar|gz|7z|swp|swo)$/i;
const secrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk_live_[A-Za-z0-9]{16,}\b/,
];
for (const path of paths) {
  if (forbidden.test(path)) findings.push({ path, reason: '公開対象外のファイル' });
  const content = execFileSync('git', ['show', `:${path}`], { maxBuffer: 30 * 1024 * 1024 });
  if (localSecrets.some(value => content.includes(value))) findings.push({ path, reason: 'ローカルの秘密情報と一致' });
  if (path.endsWith('.png')) {
    for (let position = 8; position + 12 <= content.length;) {
      const size = content.readUInt32BE(position), end = position + 12 + size;
      if (end > content.length) { findings.push({ path, reason: 'PNGの構造を確認できません' }); break; }
      const kind = content.toString('ascii', position + 4, position + 8);
      if (['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(kind)) findings.push({ path, reason: '画像の付随メタデータが残っています' });
      position = end;
    }
  }
  const text = content.toString('utf8').replaceAll('\0', '');
  if (secrets.some(pattern => pattern.test(text))) findings.push({ path, reason: '秘密情報の形式に一致' });
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role !== 'anon') findings.push({ path, reason: '公開用anon以外のJWT' }); } catch { /* Not a decodable JWT. */ }
  }
}
console.log(JSON.stringify({ checkedFiles: paths.length, findings, note: '既知の秘密情報の形式だけを検査します。権利・個人情報・画像の確認は別途必要です。' }, null, 2));
if (findings.length) process.exitCode = 1;
