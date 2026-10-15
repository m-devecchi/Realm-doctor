#!/usr/bin/env node
// plugin/skills and plugin/reference are symlinks to .claude/skills and .claude/reference, so there is one copy.
// This script (re)creates them: run it if a checkout turned them into plain files (Windows without symlink support)
// or if they are missing. `npm test` fails if they are not symlinks to the right place.
import {lstatSync, readlinkSync, rmSync, symlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['skills', 'reference']) {
  const link = join(ROOT, 'plugin', dir);
  const target = join('..', '.claude', dir);
  const current = lstatSync(link, {throwIfNoEntry: false});
  if (current?.isSymbolicLink() && readlinkSync(link) === target) continue;
  rmSync(link, {recursive: true, force: true});
  try {
    symlinkSync(target, link, 'dir');
  } catch (error) {
    console.error(`Cannot create the symlink plugin/${dir} -> ${target}: ${error.message}`);
    console.error('On Windows enable Developer Mode (or run as administrator) and set `git config core.symlinks true`.');
    process.exit(1);
  }
}
console.log('plugin/skills and plugin/reference link to .claude/');
