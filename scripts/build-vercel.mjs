import { spawnSync } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
const production = process.env.VERCEL_ENV === 'production';
if (production && (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error('Production requires public Supabase connection settings in Vercel.');
}
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', production ? 'build' : 'build:demo'], { stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(result.status || 1);
if (!production) {
  rmSync('dist', { recursive: true, force: true });
  renameSync('dist-demo', 'dist');
}
