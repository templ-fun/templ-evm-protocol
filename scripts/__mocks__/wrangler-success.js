#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');

const args = process.argv.slice(2);

if (args[0] === 'secret' && args[1] === 'put') {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', () => {});
  const exitTimer = setTimeout(() => {
    process.exit(0);
  }, 500);
  process.stdin.on('end', () => {
    clearTimeout(exitTimer);
    process.exit(0);
  });
  process.stdin.resume();
  return;
}

if (args[0] === 'd1' && args[1] === 'execute') {
  const fileIndex = args.indexOf('--file');
  if (fileIndex !== -1) {
    const filePath = args[fileIndex + 1];
    if (filePath) {
      try {
        fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        console.error(`[wrangler-success mock] failed to read ${filePath}: ${err.message}`);
        process.exit(1);
      }
    }
  }
  process.exit(0);
}

process.exit(0);
