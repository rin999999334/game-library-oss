export const minimumToolVersions = { vite: [8, 3, 8], rolldown: [1, 2, 17] };
export function stableVersionAtLeast(value, minimum) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) return false;
  const actual = value.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  }
  return true;
}
export function toolchainFindings(lock, installed, paths = {}) {
  const findings = [];
  for (const [name, minimum] of Object.entries(minimumToolVersions)) {
    const locked = lock.packages?.[paths[name] ?? `node_modules/${name}`]?.version;
    if (!stableVersionAtLeast(locked, minimum)) findings.push(`${name}: lockfileの更新が必要です。最低バージョン ${minimum.join('.')}`);
    if (!stableVersionAtLeast(installed[name], minimum)) findings.push(`${name}: インストール済みパッケージの更新が必要です。`);
    if (locked !== installed[name]) findings.push(`${name}: lockfileとインストール済みバージョンが一致しません。`);
  }
  return findings;
}
