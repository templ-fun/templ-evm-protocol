#!/usr/bin/env node
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const binExtension = process.platform === 'win32' ? '.cmd' : '';
const vitestBin = resolve(scriptDir, `../node_modules/.bin/vitest${binExtension}`);

const extraArgs = process.argv.slice(2);
const sanitizedArgs = extraArgs.filter((arg) => arg !== '--runInBand');

if (sanitizedArgs.length !== extraArgs.length) {
  console.warn('[templ] Ignoring deprecated --runInBand flag; Vitest manages concurrency internally.');
}

const child = spawn(vitestBin, ['run', ...sanitizedArgs], { stdio: 'inherit' });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
