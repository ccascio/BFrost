/**
 * check-manifest-enums.js
 *
 * Validates that the trust-level handling in the BFrost host UI stays in sync
 * with the canonical enum arrays published by BFrost-Workers.
 *
 * Run via:  node scripts/check-manifest-enums.js
 * Or:       npm run check:manifest
 *
 * What it checks:
 *   1. Every canonical TrustLevel has an explicit case in storeTrustTone()
 *      inside web/src/App.tsx (case-insensitive: 'Core' maps to 'core').
 *      A missing case means a new trust value silently falls through to
 *      'community' and renders without the intended badge style.
 *   2. Every CSS tone returned by storeTrustTone() has a
 *      .store-trust-badge.<tone> class in web/src/styles.css.
 *   3. Every canonical WorkerPermission has an entry in the PERMISSION_INFO
 *      map in web/src/App.tsx. A missing entry means the install consent
 *      dialog falls back to the raw permission key with no human-readable
 *      description.
 *
 * Exit codes:  0 = pass,  1 = fail.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const CDN_URL =
  'https://raw.githubusercontent.com/ccascio/bfrost-workers/main/dist/manifest-enums.json';
const LOCAL_FALLBACK = resolve(__dirname, '../../BFrost-Workers/dist/manifest-enums.json');

// ---------------------------------------------------------------------------
// 1. Load canonical enums
// ---------------------------------------------------------------------------

async function loadCanonicalEnums() {
  try {
    const res = await fetch(CDN_URL);
    if (res.ok) {
      const json = await res.json();
      console.log('  ✓ Loaded canonical enums from CDN');
      return json;
    }
    console.warn(`  ⚠ CDN returned HTTP ${res.status}, trying local fallback…`);
  } catch (err) {
    console.warn(`  ⚠ CDN fetch failed (${err.message}), trying local fallback…`);
  }

  try {
    const raw = readFileSync(LOCAL_FALLBACK, 'utf8');
    console.log('  ✓ Loaded canonical enums from local fallback');
    return JSON.parse(raw);
  } catch {
    console.error(`  ✗ Could not load local fallback at ${LOCAL_FALLBACK}`);
    console.error('    Run `npm run generate:enums` in BFrost-Workers first.');
    console.error('');
    console.error('    Push order matters: BFrost-Workers must be pushed (and GitHub must');
    console.error('    serve the file) BEFORE running this check against the CDN in CI.');
    console.error('    Until then, the local fallback path above must exist.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 2. Load source files
// ---------------------------------------------------------------------------

function loadSource(relPath) {
  const path = resolve(root, relPath);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    console.error(`  ✗ Could not read ${path}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 3. Parse storeTrustTone() — extract explicit === comparisons
//    The function normalizes trust to lowercase before comparing, so we look
//    for lowercase versions of canonical values.
// ---------------------------------------------------------------------------

function parseTrustToneHandled(appTsx) {
  // Find the storeTrustTone function body
  const fnMatch = appTsx.match(/function storeTrustTone\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  if (!fnMatch) {
    console.warn('  ⚠ Could not locate storeTrustTone() in App.tsx — skipping parse');
    return null;
  }
  const body = fnMatch[1];
  // Extract all string literals in === comparisons within the function
  const handled = new Set();
  for (const m of body.matchAll(/===\s*['"]([^'"]+)['"]/g)) {
    handled.add(m[1]);
  }
  return handled;
}

// ---------------------------------------------------------------------------
// 4. Run
// ---------------------------------------------------------------------------

const canonical = await loadCanonicalEnums();
const appTsx    = loadSource('web/src/App.tsx');
const stylesCss = loadSource('web/src/styles.css');

console.log('\nChecking BFrost web/src/App.tsx against canonical enums…\n');

let allOk = true;

// --- Check trust levels in storeTrustTone() --------------------------------
const handledTones = parseTrustToneHandled(appTsx);

if (handledTones) {
  const missingTrust = [];
  for (const level of canonical.trustLevels) {
    const lc = level.toLowerCase();
    // 'community' is the default fallthrough — it's fine if it's not explicit
    if (lc === 'community') continue;
    if (!handledTones.has(lc)) {
      missingTrust.push(level);
    }
  }
  if (missingTrust.length > 0) {
    console.error(`  ✗ storeTrustTone(): no explicit case for ${missingTrust.length} trust level(s):`);
    for (const v of missingTrust) {
      console.error(`      - '${v}' (looked for lowercase '${v.toLowerCase()}')`);
      console.error(`        Add: if (normalized === '${v.toLowerCase()}') return '${v.toLowerCase()}';`);
    }
    allOk = false;
  } else {
    console.log(`  ✓ storeTrustTone(): handles all ${canonical.trustLevels.length - 1} non-default trust levels`);
  }
}

// --- Check CSS classes for all trust tones ----------------------------------
// Collect all tones returned by storeTrustTone (both explicit and default)
const expectedTones = new Set(['community']); // default
if (handledTones) {
  for (const tone of handledTones) expectedTones.add(tone);
}

const missingCss = [];
for (const tone of expectedTones) {
  if (!stylesCss.includes(`.store-trust-badge.${tone}`)) {
    missingCss.push(tone);
  }
}
if (missingCss.length > 0) {
  console.error(`  ✗ styles.css: missing .store-trust-badge CSS class for ${missingCss.length} tone(s):`);
  for (const t of missingCss) console.error(`      - .store-trust-badge.${t}`);
  allOk = false;
} else {
  console.log(`  ✓ styles.css: .store-trust-badge classes present for all ${expectedTones.size} tones`);
}

// --- Check PERMISSION_INFO covers all canonical permissions -----------------
// Extract the PERMISSION_INFO block, then collect every object key inside it.
// The block starts with "const PERMISSION_INFO" and ends at the matching "};".
const permInfoKeys = new Set();
const piMatch = appTsx.match(/const PERMISSION_INFO[^=]*=\s*\{([\s\S]*?)\n\};/);
if (piMatch) {
  for (const m of piMatch[1].matchAll(/^\s+'([^']+)':\s*\{/gm)) {
    permInfoKeys.add(m[1]);
  }
} else {
  console.warn('  ⚠ Could not locate PERMISSION_INFO in App.tsx — skipping permission check');
}

const missingPermInfo = [];
for (const perm of canonical.permissions) {
  if (!permInfoKeys.has(perm)) {
    missingPermInfo.push(perm);
  }
}
if (missingPermInfo.length > 0) {
  console.error(`  ✗ PERMISSION_INFO: missing entries for ${missingPermInfo.length} canonical permission(s):`);
  for (const p of missingPermInfo) {
    console.error(`      - '${p}'`);
    console.error(`        Add a '${p}': { label: '…', description: '…' } entry to PERMISSION_INFO in web/src/App.tsx`);
  }
  allOk = false;
} else {
  console.log(`  ✓ PERMISSION_INFO: covers all ${canonical.permissions.length} canonical permission(s)`);
}

console.log('');

if (!allOk) {
  console.error('✗ Enum mismatch detected.');
  console.error('  Update web/src/App.tsx (storeTrustTone, PERMISSION_INFO) and/or web/src/styles.css.');
  process.exit(1);
} else {
  console.log('✓ All enum checks pass. BFrost UI is in sync with the canonical schema.');
}
