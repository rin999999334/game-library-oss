import { readToolchain } from './scripts/lib/read-toolchain.mjs';
import { readFileSync } from 'node:fs';
import { toolchainFindings } from './scripts/lib/security-policy.mjs';
import { assertPublicKey } from './src/public-connection.ts';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { publicShellFiles } from './build/public-shell.ts';

function offlineShell(): Plugin {
  return {
    name: 'offline-shell', apply: 'build',
    generateBundle(_, bundle) {
      const assets = publicShellFiles(bundle, resolve(import.meta.dirname, 'index.html'));
      const shell = [...new Set(['/', '/index.html', '/manifest.webmanifest', '/app-icon-v2-180.png', '/app-icon-v2-192.png', '/app-icon-v2-512.png', ...assets.map(name => '/' + name)])];
      const version = createHash('sha256').update(shell.join(',')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'game-library-${version}';
const SHELL = ${JSON.stringify(shell)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('game-library-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('push', event => {
  let message={title:'かくれんぼ',body:'こんにちは',url:'/#notifications'};
  try { if(event.data) message={...message,...event.data.json()}; } catch {}
  event.waitUntil(self.registration.showNotification(message.title,{
    body:message.body,icon:'/app-icon-v2-192.png',tag:'hello-test',data:{url:'/#notifications'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients => {
    const url=new URL('/#notifications',self.location.origin).href;
    for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.navigate(url);return client.focus();}}
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
});
` });
    }
  };
}
export default defineConfig(({ mode, command }) => {
  const root = import.meta.dirname;
  const env = loadEnv(mode, root, 'VITE_');
  assertPublicKey(env.VITE_SUPABASE_PUBLISHABLE_KEY);
  for (const value of Object.values(env)) {
    if (value.startsWith('sb_secret_') || /^eyJ[A-Za-z0-9_-]+\./.test(value)) assertPublicKey(value);
  }
  if (Object.keys(env).some(name => /SECRET|PRIVATE|PASSWORD|SERVICE_ROLE/i.test(name))) {
    throw new Error('秘密情報をVITE_環境変数に設定できません。値は表示しません。');
  }
  if (command === 'serve') {
    const { installed, paths } = readToolchain(root);
    const findings = toolchainFindings(JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')), installed, paths);
    if (findings.length) throw new Error('開発サーバーを停止しました。npm run security:toolchain で依存パッケージの更新要件を確認してください。');
  }
  const input: Record<string, string> = { app: resolve(import.meta.dirname, 'index.html') };
  if (mode !== 'demo') input.admin = resolve(import.meta.dirname, 'admin/index.html');
  return { plugins: [react(), offlineShell()], build: { sourcemap: false, rolldownOptions: { input } } };
});
