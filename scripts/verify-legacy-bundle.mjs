import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { hash } from './legacy-data.mjs';

assert(process.argv[2], 'Supply the private bundle directory');
const root = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
for (const file of manifest.files) {
  const path = resolve(root, file.path);
  assert(path.startsWith(root + sep), 'Unsafe manifest path');
  const bytes = await readFile(path);
  assert.equal(bytes.length, file.bytes, `Size mismatch: ${file.path}`);
  assert.equal(hash(bytes), file.sha256, `Hash mismatch: ${file.path}`);
}
console.log(`Verified ${manifest.files.length} bundle files`);
