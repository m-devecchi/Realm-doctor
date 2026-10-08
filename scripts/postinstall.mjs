#!/usr/bin/env node
// Runs after `npm install`. In a clone of the repository it creates local dw.json and .env from the
// examples if they are missing (the build runs in `prepare`). When the package is installed by npx or
// as a dependency it does nothing. Nothing is installed globally and nothing outside the folder changes.
import {copyFileSync, existsSync} from 'node:fs';
import {dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.REALM_DOCTOR_SKIP_POSTINSTALL) {
  console.log('realm-doctor: postinstall skipped (REALM_DOCTOR_SKIP_POSTINSTALL is set).');
  process.exit(0);
}
// installed by npx, as a dependency, or prepared by npm from git: not a working copy
const inClone = existsSync(join(ROOT, '.git')) && !ROOT.split(sep).includes('node_modules') && !/[\\/]_cacache[\\/]/.test(ROOT);
if (!inClone) process.exit(0);

const dw = join(ROOT, 'dw.json');
let created = false;
if (!existsSync(dw)) {
  copyFileSync(join(ROOT, 'config', 'dw.example.json'), dw);
  created = true;
}
const dotenv = join(ROOT, '.env');
if (!existsSync(dotenv)) copyFileSync(join(ROOT, 'config', 'env.example'), dotenv);

console.log(`
realm-doctor is installed in this folder.

  Local tools:  npx realm-doctor   npx b2c   npx b2c-dx-mcp
  Skills:       .claude/skills (read by Claude Code and GitHub Copilot)
  MCP config:   .mcp.json and .vscode/mcp.json
  Instances:    dw.json${created ? ' (created from config/dw.example.json: replace the example values)' : ''}
  Environment:  .env (telemetry off)

Next:
  1. Edit dw.json with your instances (hostname, client-id, client-secret).
  2. npm run doctor
  3. Open this folder in GitHub Copilot or Claude Code and ask, e.g. "check the kit for instance acme-stg".
`);
