import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join, dirname } from 'node:path';

// Deliberately allowlist scraped data: never copy sessions, SQL dumps or deployment secrets.
if (!process.argv[2])
  throw new Error(
    'Usage: node scripts/prepare-legacy-bundle.mjs <completed fresh snapshot> [new destination]'
  );
const source = resolve(process.argv[2]);
const snapshot = JSON.parse(await readFile(join(source, 'snapshot.json'), 'utf8'));
const destination = resolve(
  process.argv[3] ?? `.data/migration-bundles/${new Date().toISOString().replaceAll(':', '-')}`
);
await mkdir(dirname(destination), { recursive: true });
await mkdir(destination, { recursive: false });
for (const name of [
  'snapshot.json',
  'users.json',
  'protocols.json',
  'lectures.json',
  'file-manifest.json',
  'missing-files.json',
  'preparation-report.json',
  'prepared.json',
  'prepared.sha256',
  'corrections.json',
  'harmonization-plan.json',
  'reviewed-unchanged.json',
  'files'
]) {
  await cp(join(source, name), join(destination, name), {
    recursive: true,
    errorOnExist: true,
    force: false
  });
}
const files = [];
await cp(resolve('docs/migration.md'), join(destination, 'migration-instructions.md'));
try {
  await cp(join(source, 'rehearsal-report.json'), join(destination, 'rehearsal-report.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const bytes = await readFile(path);
      files.push({
        path: relative(destination, path).replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    }
  }
}
await walk(destination);
await writeFile(
  join(destination, 'manifest.json'),
  JSON.stringify({ version: 1, createdAt: new Date().toISOString(), snapshot, files }, null, 2)
);
console.log(`Prepared ${files.length} files in ${destination}`);
