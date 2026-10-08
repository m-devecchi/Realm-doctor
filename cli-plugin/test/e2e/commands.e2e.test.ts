/**
 * End-to-end: runs the real oclif commands (bin/run.js, built dist) against a
 * fake B2C instance over HTTPS, through the official SDK (OAuth client
 * credentials, WebDAV, OCAPI). Requires `npm run build` (done by `npm test`).
 */
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Report} from '../../src/lib/report.js';
import {analyzePromotions, type PromoBundle} from '../../src/rules/promo-rules.js';
import {startMockSfcc, type MockSfcc} from './mock-sfcc.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'test', 'fixtures');
const bundle = JSON.parse(readFileSync(join(FIX, 'promo', 'bundle.json'), 'utf8')) as PromoBundle;

let sfcc: MockSfcc;
let work: string;

interface RunResult {
  status: number | null;
  report?: Report<any>;
  stdout: string;
  stderr: string;
}

/** Async on purpose: the fake instance runs in this process and must keep serving while the command runs. */
function run(args: string[], extraEnv: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'bin', 'run.js'), ...args], {
      cwd: work,
      env: {
        ...process.env,
        HOME: join(work, 'home'),
        NODE_EXTRA_CA_CERTS: sfcc.caFile,
        NO_PROXY: 'localhost,127.0.0.1',
        no_proxy: 'localhost,127.0.0.1',
        REALM_DOCTOR_CACHE: join(work, 'cache'),
        SFCC_SAFETY_CONFIG: join(work, 'safety.json'),
        ...extraEnv,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      let report: Report<any> | undefined;
      try {
        report = JSON.parse(stdout);
      } catch {
        report = undefined;
      }
      resolve({status, report, stdout, stderr});
    });
  });
}

const instanceArgs = () => ['--server', sfcc.host, '--account-manager-host', sfcc.host, '--client-id', 'test-client', '--client-secret', 'test-secret', '--json'];
const ruleIds = (r?: Report) => (r?.findings ?? []).map((f) => f.rule).sort();

beforeAll(async () => {
  if (!existsSync(join(ROOT, 'dist', 'commands', 'audit', 'errors.js'))) throw new Error('Run `npm run build` first.');
  work = mkdtempSync(join(tmpdir(), 'realm-doctor-e2e-'));
  // The safety policy recommended in config/safety.example.json
  writeFileSync(
    join(work, 'safety.json'),
    JSON.stringify({level: 'READ_ONLY', rules: [{method: 'POST', path: '/s/-/dw/data/*/sites/*/*_search', action: 'allow'}]}),
  );
  sfcc = await startMockSfcc({
    logsDir: join(FIX, 'logs'),
    cartridgesDir: join(FIX, 'cartridges'),
    codeVersion: 'v1',
    promoBundle: bundle,
    maxPage: 5,
  });
});

afterAll(async () => {
  await sfcc?.close();
});

describe('audit commands against a fake instance (READ_ONLY safety)', () => {
  it('audit errors: new error + spike, personal data masked', async () => {
    const {status, report, stderr} = await run(['audit', 'errors', '--since', '2026-10-01T00:00:00Z', ...instanceArgs()]);
    expect(status, stderr).toBe(0);
    expect(ruleIds(report)).toEqual(['ERR-001', 'ERR-002']);
    expect(report!.data.files).toBe(3);
    expect(report!.data.entries).toBe(78);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/@example\.com|93\.184\.216|order 000\d+/);
    expect(text).toContain('order <NUM>');
  });

  it('audit errors --max-kb: reads only the tail of large files with an HTTP Range request', async () => {
    const before = sfcc.requests.length;
    const {status, report, stderr} = await run(['audit', 'errors', '--since', '2026-10-08T00:00:00Z', '--max-kb', '4', ...instanceArgs()]);
    expect(status, stderr).toBe(0);
    expect(report!.notes.join()).toMatch(/1 file letti solo in coda/);
    const ranged = sfcc.requests.slice(before).filter((r) => r.range);
    expect(ranged).toHaveLength(1);
    expect(ranged[0].path).toMatch(/error-blade1-0-appserver-20261008\.log$/);
    expect(report!.data.entries).toBeGreaterThan(0);
    expect(report!.data.entries).toBeLessThan(55);
  });

  it('audit quota: limits and warnings per quota', async () => {
    const {status, report, stderr} = await run(['audit', 'quota', '--since', '2026-10-01T00:00:00Z', ...instanceArgs()]);
    expect(status, stderr).toBe(0);
    expect(ruleIds(report)).toEqual(['QUOTA-001', 'QUOTA-002', 'QUOTA-003', 'QUOTA-003']);
    expect(report!.summary.bySeverity.critical).toBe(1);
  });

  it('audit code: reads the active code version over WebDAV and matches the local analysis', async () => {
    const remote = await run(['audit', 'code', ...instanceArgs()]);
    const local = await run(['audit', 'code', '--dir', join(FIX, 'cartridges'), '--json']);
    expect(remote.status, remote.stderr).toBe(0);
    expect(local.status, local.stderr).toBe(0);
    expect(remote.report!.target.codeVersion).toBe('v1');
    expect(remote.report!.data.files).toBe(5);
    expect(ruleIds(remote.report)).toEqual(ruleIds(local.report));
    expect(remote.report!.summary.findings).toBe(14);
  });

  it('audit code --cartridge limits the analysis', async () => {
    const {status, report} = await run(['audit', 'code', '--cartridge', 'app_clean', ...instanceArgs()]);
    expect(status).toBe(0);
    expect(report!.data.files).toBe(1);
    expect(report!.summary.findings).toBe(0);
  });

  it('audit hyperforce: uses the code cache and reports IP + hostname', async () => {
    const {status, report, stderr} = await run(['audit', 'hyperforce', ...instanceArgs()]);
    expect(status, stderr).toBe(0);
    expect(ruleIds(report)).toEqual(['HF-001', 'HF-002']);
    expect(report!.notes.join()).toMatch(/5 dalla cache/);
  });

  it('audit promotions: pages through OCAPI searches and finds the same issues as the offline analysis', async () => {
    const save = join(work, 'bundle.json');
    const {status, report, stderr} = await run(['audit', 'promotions', '--site', 'RefArch', '--currency', 'EUR', '--now', bundle.now!, '--save', save, ...instanceArgs()]);
    expect(status, stderr).toBe(0);
    expect(report!.data.counts).toEqual({promotions: 14, campaigns: 5, assignments: 14, coupons: 4, customerGroups: 2});
    expect(ruleIds(report)).toEqual(analyzePromotions(bundle).map((f) => f.rule).sort());
    // the saved bundle reproduces the same result offline
    const offline = await run(['audit', 'promotions', '--input', save, '--now', bundle.now!, '--currency', 'EUR', '--json']);
    expect(ruleIds(offline.report)).toEqual(ruleIds(report));
  });

  it('audit promotions: unknown site fails with a clear error', async () => {
    const {status, stderr, stdout} = await run(['audit', 'promotions', '--site', 'Nope', ...instanceArgs()]);
    expect(status).not.toBe(0);
    expect(stderr + stdout).toMatch(/promotion_search failed|SiteNotFound/);
  });

  it('Safety Mode READ_ONLY without the search exception blocks OCAPI searches before they reach the instance', async () => {
    writeFileSync(join(work, 'strict.json'), JSON.stringify({level: 'READ_ONLY'}));
    const before = sfcc.requests.filter((r) => r.path.endsWith('_search')).length;
    const {status} = await run(['audit', 'promotions', '--site', 'RefArch', ...instanceArgs()], {SFCC_SAFETY_CONFIG: join(work, 'strict.json')});
    expect(status).not.toBe(0);
    expect(sfcc.requests.filter((r) => r.path.endsWith('_search')).length).toBe(before);
  });

  it('never writes to the instance: only GET, PROPFIND, token and *_search POSTs', async () => {
    expect(sfcc.requests.length).toBeGreaterThan(30);
    const writes = sfcc.requests.filter(
      (r) => !['GET', 'PROPFIND'].includes(r.method) && !(r.method === 'POST' && (r.path.endsWith('_search') || r.path === '/dwsso/oauth2/access_token')),
    );
    expect(writes).toEqual([]);
    const unauthenticated = sfcc.requests.filter((r) => r.path !== '/dwsso/oauth2/access_token' && r.auth !== 'Bearer');
    expect(unauthenticated).toEqual([]);
  });
});

describe('commands that do not need an instance', () => {
  it('audit rules lists every rule', async () => {
    const {status, report} = await run(['audit', 'rules', '--json']);
    expect(status).toBe(0);
    expect((report as unknown as {rules: unknown[]}).rules).toHaveLength(36);
  });

  it('audit frontend with a saved PageSpeed response', async () => {
    const {status, report} = await run(['audit', 'frontend', '--url', 'https://www.example.com/', '--psi-file', join(FIX, 'psi', 'home-mobile.json'), '--json']);
    expect(status).toBe(0);
    expect(ruleIds(report)).toEqual(['FE-001', 'FE-002', 'FE-005', 'FE-006', 'FE-007']);
  });

  it('human-readable output goes to stdout', async () => {
    const {status, stdout} = await run(['audit', 'promotions', '--input', join(FIX, 'promo', 'bundle.json')]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^realm-doctor audit promotions/);
    expect(stdout).toContain('[ALTA] PROMO-');
  });
});
