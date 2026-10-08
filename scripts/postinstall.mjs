#!/usr/bin/env node
// Runs after `npm install` in the repository root. Everything stays inside this folder:
// builds the realm-doctor commands and creates a local dw.json from the example if missing.
// Nothing is installed globally and nothing outside the repository is changed.
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.REALM_DOCTOR_SKIP_POSTINSTALL) {
  console.log('realm-doctor: postinstall skipped (REALM_DOCTOR_SKIP_POSTINSTALL is set).');
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build', '-w', 'cli-plugin'], {cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'});
if (build.status !== 0) {
  console.error('realm-doctor: build failed. Run `npm run build` to see the error.');
  process.exit(build.status ?? 1);
}

const dw = join(ROOT, 'dw.json');
let created = false;
if (!existsSync(dw)) {
  copyFileSync(join(ROOT, 'config', 'dw.example.json'), dw);
  created = true;
}

console.log(`
realm-doctor is installed in this folder.

  Local tools:  npx realm-doctor   npx b2c   npx b2c-dx-mcp
  Skills:       .claude/skills (read by Claude Code and GitHub Copilot)
  MCP config:   .mcp.json and .vscode/mcp.json
  Instances:    dw.json${created ? ' (created from config/dw.example.json: replace the example values)' : ''}

Next:
  1. Edit dw.json with your instances (hostname, client-id, client-secret).
  2. npm run doctor
  3. Open this folder in GitHub Copilot or Claude Code and ask, e.g. "check the kit for instance acme-stg".
`);
