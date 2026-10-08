#!/usr/bin/env node
// Copies the skills and their reference files into the Claude Code plugin (plugin/), which is installed
// on its own and cannot reach files outside its folder. `npm test` fails if the copy is out of date.
import {cpSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['skills', 'reference']) {
  rmSync(join(ROOT, 'plugin', dir), {recursive: true, force: true});
  cpSync(join(ROOT, '.claude', dir), join(ROOT, 'plugin', dir), {recursive: true});
}
console.log('plugin/skills and plugin/reference updated from .claude/');
