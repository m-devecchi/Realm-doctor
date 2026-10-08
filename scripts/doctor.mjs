#!/usr/bin/env node
// `npm run doctor`: checks the local installation and dw.json without changing anything.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_HOSTS = /acme|globex|zzzz-001/i;
const SEARCH_RULES = [
  '/s/-/dw/data/*/sites/*/*_search',
  '/s/-/dw/data/*/job_execution_search',
  '/operation/jobs/v1/organizations/*/job-execution-search',
  '/pricing/promotions/v1/organizations/*/promotions',
  '/pricing/campaigns/v1/organizations/*/campaigns',
  '/pricing/coupons/v1/organizations/*/coupons',
];

/**
 * @param {{root?: string, env?: NodeJS.ProcessEnv, nodeVersion?: string}} [opts]
 * @returns {Array<{check: string, status: 'OK'|'WARN'|'FAIL', note: string}>}
 */
export function runChecks(opts = {}) {
  const root = opts.root ?? DEFAULT_ROOT;
  const env = opts.env ?? process.env;
  const results = [];
  const add = (check, status, note = '') => results.push({check, status, note});

  // Node.js
  const major = Number((opts.nodeVersion ?? process.versions.node).split('.')[0]);
  add('Node.js >= 22', major >= 22 ? 'OK' : 'FAIL', `found ${opts.nodeVersion ?? process.versions.node}`);

  // Local tools (no global installs)
  const bin = (name) => join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  for (const name of ['b2c', 'b2c-dx-mcp', 'realm-doctor']) {
    add(`Local tool: ${name}`, existsSync(bin(name)) ? 'OK' : 'FAIL', existsSync(bin(name)) ? `npx ${name}` : 'run `npm install` in the repository root');
  }
  const built = existsSync(join(root, 'cli-plugin', 'dist', 'commands', 'audit', 'errors.js'));
  add('realm-doctor commands built', built ? 'OK' : 'FAIL', built ? '' : 'run `npm run build`');

  // Skills and MCP configuration
  const skillsDir = join(root, '.claude', 'skills');
  const skills = existsSync(skillsDir) ? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, 'SKILL.md'))) : [];
  add('Skills (.claude/skills)', skills.length > 0 ? 'OK' : 'FAIL', `${skills.length} skills`);
  const refsOk = ['conventions.md', 'safety.md'].every((f) => existsSync(join(root, '.claude', 'reference', f)));
  add('Shared skill references', refsOk ? 'OK' : 'FAIL', '.claude/reference');
  for (const f of ['.mcp.json', join('.vscode', 'mcp.json')]) {
    const p = join(root, f);
    const ok = existsSync(p) && readFileSync(p, 'utf8').includes('b2c-dx-mcp');
    add(`MCP config ${f}`, ok ? 'OK' : 'FAIL', ok ? 'b2c-dx-mcp' : 'missing b2c-dx-mcp server');
  }

  // Secrets must never be committed
  const gitignore = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : '';
  const ignored = ['dw.json', '.env', '.cache/'].every((e) => gitignore.split(/\r?\n/).includes(e));
  add('.gitignore protects dw.json, .env, .cache/', ignored ? 'OK' : 'FAIL');
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'dw.json'], {cwd: root, encoding: 'utf8'});
  if (tracked.status === 0) add('dw.json not tracked by git', 'FAIL', 'run `git rm --cached dw.json`');

  // dw.json
  const dwPath = join(root, 'dw.json');
  if (!existsSync(dwPath)) {
    add('dw.json', 'FAIL', 'copy config/dw.example.json to dw.json and fill in your instances');
    return results;
  }
  let dw;
  try {
    dw = JSON.parse(readFileSync(dwPath, 'utf8'));
  } catch (e) {
    add('dw.json', 'FAIL', `invalid JSON: ${e.message}`);
    return results;
  }
  const configs = Array.isArray(dw.configs) ? dw.configs : [dw];
  add('dw.json', configs.length > 0 ? 'OK' : 'FAIL', `${configs.length} instance(s)`);
  const dotenv = existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : '';
  const envSecret = Boolean(env.SFCC_CLIENT_SECRET) || /^\s*SFCC_CLIENT_SECRET\s*=\s*\S+/m.test(dotenv);

  for (const c of configs) {
    const name = c.name ?? '(default)';
    const host = c.hostname ?? c.server;
    if (!host) add(`[${name}] hostname`, 'FAIL', 'missing');
    else if (EXAMPLE_HOSTS.test(host)) add(`[${name}] hostname`, 'WARN', `example value ${host}: replace it`);
    else add(`[${name}] hostname`, 'OK', host);

    const clientId = c['client-id'] ?? c.clientId;
    if (!clientId || /^0{8}-/.test(clientId)) add(`[${name}] client-id`, 'WARN', 'missing or example value');
    else add(`[${name}] client-id`, 'OK');

    const secret = c['client-secret'] ?? c.clientSecret;
    add(`[${name}] client secret`, secret || envSecret ? 'OK' : 'WARN', secret ? 'in dw.json (local, git-ignored)' : envSecret ? 'from SFCC_CLIENT_SECRET' : 'set client-secret in dw.json or SFCC_CLIENT_SECRET in .env');

    const level = c.safety?.level;
    add(`[${name}] Safety Mode`, level === 'READ_ONLY' ? 'OK' : 'FAIL', level ? `level ${level}` : 'no safety policy: add the one from config/dw.example.json');
    const rules = (c.safety?.rules ?? []).map((r) => r.path);
    const missing = SEARCH_RULES.filter((r) => !rules.includes(r));
    if (level === 'READ_ONLY' && missing.length) {
      add(`[${name}] search exception`, 'WARN', `missing allow rules (jobs or promotions audits blocked): ${missing.join(', ')}. Copy the safety block from config/dw.example.json`);
    }
    if (!c['short-code'] || !c['tenant-id']) {
      add(`[${name}] SCAPI`, 'WARN', 'no short-code/tenant-id: OCAPI only. Instances without OCAPI (new ones) need both (Business Manager > Administration > Site Development > Salesforce Commerce API Settings)');
    }
  }
  return results;
}

export function format(results) {
  const w = Math.max(...results.map((r) => r.check.length));
  return results.map((r) => `${r.status.padEnd(4)}  ${r.check.padEnd(w)}  ${r.note}`).join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = runChecks();
  console.log(format(results));
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  console.log(`\n${fail} failed, ${warn} warnings.`);
  process.exit(fail ? 1 : 0);
}
