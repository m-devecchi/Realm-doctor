#!/usr/bin/env node
// One version for the whole kit: node scripts/set-version.mjs 0.4.0
// Updates the root package, the CLI package, the plugin manifest, the lockfile entries and the pinned `github:...#vX.Y.Z`
// spec in the docs and examples. `npm test` fails if they differ. Then tag the release: git tag vX.Y.Z && git push origin vX.Y.Z
// (the plugin and the install commands run that tag, so it must exist before users update).
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
const SPEC = /github:m-devecchi\/Realm-doctor(#v\d+\.\d+\.\d+(-[\w.]+)?)?/g;
for (const file of [
  'README.md',
  'docs/architecture.md',
  'plugin/.claude-plugin/plugin.json',
  '.claude/skills/realm-doctor-setup/SKILL.md',
  'cli-plugin/src/commands/init.ts',
  'cli-plugin/src/commands/install/copilot.ts',
]) {
  const path = join(ROOT, file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(SPEC, `github:m-devecchi/Realm-doctor#v${version}`));
}
console.log(`Version set to ${version}. Now tag it: git tag v${version} && git push origin v${version}`);
