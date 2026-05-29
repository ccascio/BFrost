import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeArchiveNames, assertNoSymlinkEntries } from './admin-server';

// These guard worker zip/tarball installs against zip-slip / tar-slip path traversal and
// symlink-based escape. The verbose-listing assumption (`unzip -Z` / `tar -tvzf` emit the
// entry type as the first column, `l` for a symlink) was confirmed against the real tools;
// these cases lock in the parsing so a future refactor can't silently reopen the hole.

test('assertSafeArchiveNames rejects parent-directory traversal', () => {
  assert.throws(() => assertSafeArchiveNames(['ok/file.txt', '../escape.txt']), /path-traversal/);
  assert.throws(() => assertSafeArchiveNames(['a/../../b']), /path-traversal/);
});

test('assertSafeArchiveNames rejects absolute paths (posix and windows)', () => {
  assert.throws(() => assertSafeArchiveNames(['/etc/passwd']), /absolute path/);
  assert.throws(() => assertSafeArchiveNames(['C:/Windows/system32']), /absolute path/);
  assert.throws(() => assertSafeArchiveNames(['..\\winescape']), /path-traversal/);
});

test('assertSafeArchiveNames accepts ordinary nested entries', () => {
  assert.doesNotThrow(() =>
    assertSafeArchiveNames(['worker.json', 'src/index.ts', 'frontend/dashboard.tsx', '']),
  );
});

test('assertNoSymlinkEntries rejects a symlink line from unzip -Z / tar -tvzf', () => {
  // Real unzip -Z output for a symlink entry.
  assert.throws(
    () => assertNoSymlinkEntries(['lrwxr-xr-x  3.0 unx       11 bx stor 26-May-29 12:10 link']),
    /symbolic link/,
  );
  // Real tar -tvzf output for a symlink entry.
  assert.throws(
    () => assertNoSymlinkEntries(['lrwxr-xr-x  0 user wheel 0 May 29 12:10 link -> /etc/passwd']),
    /symbolic link/,
  );
});

test('assertNoSymlinkEntries accepts files, dirs, and listing headers', () => {
  assert.doesNotThrow(() =>
    assertNoSymlinkEntries([
      'Archive:  t.zip',
      'Zip file size: 323 bytes, number of entries: 2',
      '-rw-r--r--  3.0 unx        6 tx stor 26-May-29 12:10 normal.txt',
      'drwxr-xr-x  0 user wheel 0 May 29 12:10 src/',
      '2 files, 17 bytes uncompressed',
      '',
    ]),
  );
});
