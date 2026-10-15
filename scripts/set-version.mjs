#!/usr/bin/env node
// One version for the whole kit: node scripts/set-version.mjs 0.4.0
// Updates the root package, the CLI package, the plugin manifest and the lockfile entries. `npm test` fails if they differ.
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('Usage: node scripts/set-version.mjs <major.minor.patch>');
  process.exit(1);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const edit = (file, fn) => {
  const path = join(ROOT, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  fn(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
};
edit('package.json', (j) => (j.version = version));
edit('cli-plugin/package.json', (j) => (j.version = version));
edit('plugin/.claude-plugin/plugin.json', (j) => (j.version = version));
edit('package-lock.json', (j) => {
  j.version = version;
  if (j.packages?.['']) j.packages[''].version = version;
  if (j.packages?.['cli-plugin']) j.packages['cli-plugin'].version = version;
});
console.log(`Version set to ${version}`);
