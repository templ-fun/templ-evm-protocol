#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { domainManifestSchema } from '@farcaster/miniapp-sdk';

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '../public/.well-known/farcaster.json');
  const raw = await readFile(manifestPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('Mini app manifest parse failed:', err?.message || err);
    process.exit(1);
  }
  try {
    domainManifestSchema.parse(parsed);
  } catch (err) {
    console.error('Mini app manifest failed validation:\n', err);
    process.exit(1);
  }
  console.log('Mini app manifest is valid ✅');
}

main().catch((err) => {
  console.error('Mini app manifest validation crashed:', err?.stack || err);
  process.exit(1);
});
