#!/usr/bin/env node
// The plugin manifest pins the official Salesforce MCP server (@salesforce/b2c-dx-mcp) to the version in package.json,
// so a Dependabot bump of that package needs the manifest updated too. Run this after changing the version
// (`npm test` fails with a pointer here when they differ). The install commands read the version from package.json.
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies['@salesforce/b2c-dx-mcp'];
const file = join(ROOT, 'plugin', '.claude-plugin', 'plugin.json');
const before = readFileSync(file, 'utf8');
const after = before.replace(/@salesforce\/b2c-dx-mcp@[\w.-]+/g, `@salesforce/b2c-dx-mcp@${version}`);
if (after !== before) writeFileSync(file, after);
console.log(`plugin.json uses @salesforce/b2c-dx-mcp@${version}${after === before ? ' (already)' : ' (updated)'}`);
