#!/usr/bin/env node
// Validates every workers/examples/*/worker.json against the required manifest fields.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '..', 'workers', 'examples');

const REQUIRED_FIELDS = ['manifestVersion', 'bfrostApiVersion', 'id', 'name', 'version', 'description'];
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

let failures = 0;

for (const entry of readdirSync(examplesDir)) {
  const manifestPath = join(examplesDir, entry, 'worker.json');
  try {
    statSync(manifestPath);
  } catch {
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${manifestPath}: invalid JSON — ${err.message}`);
    failures++;
    continue;
  }

  let ok = true;
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
      console.error(`FAIL ${manifestPath}: missing required field "${field}"`);
      ok = false;
    }
  }

  if (manifest.id && !ID_PATTERN.test(manifest.id)) {
    console.error(`FAIL ${manifestPath}: id "${manifest.id}" does not match [a-z0-9][a-z0-9._-]*`);
    ok = false;
  }

  if (ok) {
    console.log(`OK   ${manifestPath}`);
  } else {
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} manifest(s) failed validation.`);
  process.exit(1);
}

console.log(`\nAll example manifests are valid.`);
