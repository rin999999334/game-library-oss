import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';

// Resolve Rolldown from Vite's location, just as Vite does. npm can nest it.
export function readToolchain(root = process.cwd()) {
  root = realpathSync(root);
  const require = createRequire(join(root, 'package.json'));
  const installed = {}, paths = {};
  let viteRequire;
  try {
    const file = require.resolve('vite/package.json');
    paths.vite = relative(root, file).split(sep).join('/').replace(/\/package\.json$/, '');
    installed.vite = JSON.parse(readFileSync(file, 'utf8')).version;
    viteRequire = createRequire(file);
  } catch { installed.vite = undefined; }
  try {
    const file = viteRequire.resolve('rolldown/package.json');
    paths.rolldown = relative(root, file).split(sep).join('/').replace(/\/package\.json$/, '');
    installed.rolldown = JSON.parse(readFileSync(file, 'utf8')).version;
  } catch { installed.rolldown = undefined; }
  return { installed, paths };
}
