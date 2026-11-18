import { readFileSync } from 'node:fs';
import { toolchainFindings } from './lib/security-policy.mjs';
import { readToolchain } from './lib/read-toolchain.mjs';
const { installed, paths } = readToolchain();
const findings = toolchainFindings(JSON.parse(readFileSync('package-lock.json', 'utf8')), installed, paths);
console.log(JSON.stringify({ installed, findings }, null, 2));
if (findings.length) process.exitCode = 1;
