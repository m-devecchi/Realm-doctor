/**
 * Tests for the repository scripts: `npm run doctor` (scripts/doctor.mjs) and the
 * postinstall step (scripts/postinstall.mjs). They run on temporary copies, never on
 * the real repository files.
 */
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import {FIXTURES} from './helpers.js';

const REPO = join(FIXTURES, '..', '..', '..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const {runChecks} = (await import(join(REPO, 'scripts', 'doctor.mjs'))) as {runChecks: (o: any) => Array<{check: string; status: string; note: string}>};

const instance = (over: Record<string, unknown> = {}) => ({
  name: 'lavazza-prd',
  hostname: 'production-eu01-lavazza.demandware.net',
  'client-id': '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
  'client-secret': 's3cret',
  'short-code': 'abcd1234',
  'tenant-id': 'lava_prd',
  safety: {level: 'READ_ONLY', rules: JSON.parse(readFileSync(join(REPO, 'config', 'safety.example.json'), 'utf8')).rules},
  ...over,
});

let root: string;

function fakeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rd-doctor-'));
  cpSync(join(REPO, '.claude'), join(dir, '.claude'), {recursive: true});
  cpSync(join(REPO, '.vscode'), join(dir, '.vscode'), {recursive: true});
  for (const f of ['.mcp.json', '.gitignore']) cpSync(join(REPO, f), join(dir, f));
  mkdirSync(join(dir, 'node_modules', '.bin'), {recursive: true});
  for (const b of ['b2c', 'b2c-dx-mcp', 'realm-doctor']) writeFileSync(join(dir, 'node_modules', '.bin', process.platform === 'win32' ? `${b}.cmd` : b), '');
  mkdirSync(join(dir, 'cli-plugin', 'dist', 'commands', 'audit'), {recursive: true});
  writeFileSync(join(dir, 'cli-plugin', 'dist', 'commands', 'audit', 'errors.js'), '');
  return dir;
}

const status = (results: Array<{check: string; status: string}>, check: string) => results.find((r) => r.check === check)?.status;

describe('npm run doctor', () => {
  beforeEach(() => {
    root = fakeRepo();
  });

  it('all green with a correct multi-realm dw.json', () => {
    writeFileSync(join(root, 'dw.json'), JSON.stringify({configs: [instance(), instance({name: 'maxicoffee-stg', hostname: 'staging-eu01-maxicoffee.demandware.net'})]}));
    const r = runChecks({root, env: {}});
    expect(r.filter((x) => x.status !== 'OK')).toEqual([]);
    expect(r.find((x) => x.check === 'dw.json')?.note).toBe('2 instance(s)');
  });

  it('fails when tools are not installed locally', () => {
    const empty = mkdtempSync(join(tmpdir(), 'rd-empty-'));
    const r = runChecks({root: empty, env: {}});
    expect(status(r, 'Local tool: b2c')).toBe('FAIL');
    expect(status(r, 'realm-doctor commands built')).toBe('FAIL');
    expect(status(r, 'dw.json')).toBe('FAIL');
  });

  it('fails an instance without READ_ONLY Safety Mode', () => {
    writeFileSync(join(root, 'dw.json'), JSON.stringify({configs: [instance({safety: {level: 'NONE'}})]}));
    expect(status(runChecks({root, env: {}}), '[lavazza-prd] Safety Mode')).toBe('FAIL');
  });

  it('warns on example values, missing secrets and a missing search exception', () => {
    writeFileSync(
      join(root, 'dw.json'),
      JSON.stringify({configs: [instance({hostname: 'staging-eu01-acme.demandware.net', 'client-id': '00000000-0000-0000-0000-000000000000', 'client-secret': undefined, safety: {level: 'READ_ONLY', rules: []}})]}),
    );
    const r = runChecks({root, env: {}});
    expect(status(r, '[lavazza-prd] hostname')).toBe('WARN');
    expect(status(r, '[lavazza-prd] client-id')).toBe('WARN');
    expect(status(r, '[lavazza-prd] client secret')).toBe('WARN');
    expect(status(r, '[lavazza-prd] search exception')).toBe('WARN');
  });

  it('warns when an instance has no SCAPI coordinates', () => {
    writeFileSync(join(root, 'dw.json'), JSON.stringify({configs: [instance({'short-code': undefined})]}));
    expect(status(runChecks({root, env: {}}), '[lavazza-prd] SCAPI')).toBe('WARN');
  });

  it('ignores a commented secret in .env', () => {
    writeFileSync(join(root, 'dw.json'), JSON.stringify({configs: [instance({'client-secret': undefined})]}));
    writeFileSync(join(root, '.env'), '# SFCC_CLIENT_SECRET=\nSFCC_DISABLE_TELEMETRY=true\n');
    expect(status(runChecks({root, env: {}}), '[lavazza-prd] client secret')).toBe('WARN');
  });

  it('accepts the secret from the environment or from a local .env', () => {
    writeFileSync(join(root, 'dw.json'), JSON.stringify({configs: [instance({'client-secret': undefined})]}));
    expect(status(runChecks({root, env: {SFCC_CLIENT_SECRET: 'x'}}), '[lavazza-prd] client secret')).toBe('OK');
    writeFileSync(join(root, '.env'), 'SFCC_CLIENT_SECRET=from-dotenv\n');
    expect(status(runChecks({root, env: {}}), '[lavazza-prd] client secret')).toBe('OK');
  });

  it('never prints the secret', () => {
    writeFileSync(join(root, 'dw.json'), JSON.stringify({configs: [instance()]}));
    expect(JSON.stringify(runChecks({root, env: {}}))).not.toContain('s3cret');
  });

  it('reports invalid JSON and old Node.js', () => {
    writeFileSync(join(root, 'dw.json'), '{oops');
    const r = runChecks({root, env: {}, nodeVersion: '20.11.0'});
    expect(status(r, 'dw.json')).toBe('FAIL');
    expect(status(r, 'Node.js >= 22')).toBe('FAIL');
  });

  it('fails when .gitignore does not protect dw.json', () => {
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(root, 'dw.json'), JSON.stringify({configs: [instance()]}));
    expect(status(runChecks({root, env: {}}), '.gitignore protects dw.json, .env, .cache/')).toBe('FAIL');
  });
});

describe('postinstall', () => {
  function fakeInstallRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rd-post-'));
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, '.git'));
    cpSync(join(REPO, 'scripts', 'postinstall.mjs'), join(dir, 'scripts', 'postinstall.mjs'));
    cpSync(join(REPO, 'config'), join(dir, 'config'), {recursive: true});
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name: 'x', private: true, workspaces: ['cli-plugin']}));
    return dir;
  }
  const run = (dir: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [join(dir, 'scripts', 'postinstall.mjs')], {cwd: dir, encoding: 'utf8', env: {...process.env, ...env}});

  it('in a clone: creates dw.json and .env from the examples (the build runs in prepare)', () => {
    const dir = fakeInstallRoot();
    const res = run(dir);
    expect(res.status, res.stderr).toBe(0);
    expect(readFileSync(join(dir, 'dw.json'), 'utf8')).toBe(readFileSync(join(REPO, 'config', 'dw.example.json'), 'utf8'));
    expect(readFileSync(join(dir, '.env'), 'utf8')).toMatch(/^SFCC_DISABLE_TELEMETRY=true$/m);
    expect(res.stdout).toContain('npx realm-doctor');
    expect(res.stdout).not.toMatch(/-g\b|--global/);
  });

  it('never overwrites an existing dw.json or .env', () => {
    const dir = fakeInstallRoot();
    writeFileSync(join(dir, 'dw.json'), '{"configs":[{"name":"mine-prd"}]}');
    writeFileSync(join(dir, '.env'), 'SFCC_CLIENT_SECRET=keep-me\n');
    expect(run(dir).status).toBe(0);
    expect(readFileSync(join(dir, 'dw.json'), 'utf8')).toBe('{"configs":[{"name":"mine-prd"}]}');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('SFCC_CLIENT_SECRET=keep-me\n');
  });

  it('can be skipped (CI)', () => {
    const dir = fakeInstallRoot();
    const res = run(dir, {REALM_DOCTOR_SKIP_POSTINSTALL: '1'});
    expect(res.status).toBe(0);
    expect(existsSync(join(dir, 'dw.json'))).toBe(false);
    expect(existsSync(join(dir, '.env'))).toBe(false);
  });

  it('installed by npx or as a dependency (no .git): creates nothing, prints nothing', () => {
    const dir = fakeInstallRoot();
    rmSync(join(dir, '.git'), {recursive: true});
    const res = run(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
    expect(existsSync(join(dir, 'dw.json'))).toBe(false);
  });
});
