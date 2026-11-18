import assert from 'node:assert/strict';
import test from 'node:test';
import { publicShellFiles } from '../build/public-shell.ts';
test('offline shell includes public/shared/dynamic dependencies and excludes the admin entry and grid', () => {
  const bundle = {
    'index.html': { type: 'asset', source: '<script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">' },
    'admin/index.html': { type: 'asset', source: '<script src="/assets/admin.js"></script>' },
    'assets/app.js': { type: 'chunk', isEntry: true, facadeModuleId: '/app/index.html', imports: ['assets/shared.js'], dynamicImports: ['assets/search.js'], viteMetadata: { importedCss: new Set(['assets/app.css']) } },
    'assets/shared.js': { type: 'chunk' },
    'assets/search.js': { type: 'chunk' },
    'assets/app.css': { type: 'asset' },
    'assets/admin.js': { type: 'chunk', isEntry: true, facadeModuleId: '/app/admin/index.html', imports: ['assets/shared.js','assets/grid.js'] },
    'assets/grid.js': { type: 'chunk' },
  };
  assert.deepEqual(publicShellFiles(bundle, '/app/index.html'), ['assets/app.css','assets/app.js','assets/search.js','assets/shared.js','index.html']);
});
