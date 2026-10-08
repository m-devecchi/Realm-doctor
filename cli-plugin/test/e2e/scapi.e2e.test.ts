/**
 * End-to-end on SCAPI: an instance where OCAPI is not available (new instances) and one where the API client
 * has no SCAPI scopes (fallback to OCAPI). SCAPI requests reach the fake instance through
 * test/e2e/scapi-redirect.mjs; everything else is the real code path (SDK dual backends, auth with scopes,
 * Safety Mode).
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Report} from '../../src/lib/report.js';
import {analyzePromotions, type PromoBundle} from '../../src/rules/promo-rules.js';
import {startMockSfcc, type MockSfcc} from './mock-sfcc.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'test', 'fixtures');
const PRELOAD = join(ROOT, 'test', 'e2e', 'scapi-redirect.mjs');
const bundle = JSON.parse(readFileSync(join(FIX, 'promo', 'bundle.json'), 'utf8')) as PromoBundle;
const jobs = JSON.parse(readFileSync(join(FIX, 'jobs', 'executions.json'), 'utf8'));

const SCAPI_RULES = [
  {method: 'POST', path: '/operation/jobs/v1/organizations/*/job-execution-search', action: 'allow'},
  {method: 'POST', path: '/pricing/promotions/v1/organizations/*/promotions', action: 'allow'},
  {method: 'POST', path: '/pricing/campaigns/v1/organizations/*/campaigns', action: 'allow'},
  {method: 'POST', path: '/pricing/coupons/v1/organizations/*/coupons', action: 'allow'},
];
const OCAPI_RULES = [
  {method: 'POST', path: '/s/-/dw/data/*/sites/*/*_search', action: 'allow'},
  {method: 'POST', path: '/s/-/dw/data/*/job_execution_search', action: 'allow'},
];

let work: string;
let scapiOnly: MockSfcc;
let noScopes: MockSfcc;
let client: Client;

const ruleIds = (r?: Report) => (r?.findings ?? []).map((f) => f.rule).sort();
const env = (host: string) => ({
  ...(process.env as Record<string, string>),
  HOME: join(work, 'home'),
  NODE_EXTRA_CA_CERTS: join(work, 'ca.pem'),
  NO_PROXY: 'localhost,127.0.0.1',
  no_proxy: 'localhost,127.0.0.1',
  REALM_DOCTOR_CACHE: join(work, 'cache'),
  REALM_DOCTOR_TEST_SCAPI_HOST: host,
  SFCC_SAFETY_CONFIG: '',
});

async function call(name: string, args: Record<string, unknown>): Promise<{isError?: boolean; text: string; json?: any}> {
  const res = (await client.callTool({name, arguments: args})) as {isError?: boolean; content: Array<{text: string}>};
  const text = res.content.map((c) => c.text).join('');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {isError: res.isError, text, json};
}

const ocapiRequests = (m: MockSfcc) => m.requests.filter((r) => r.path.startsWith('/s/-/dw/data'));
const scapiRequests = (m: MockSfcc) => m.requests.filter((r) => r.path.startsWith('/scapi/'));

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'realm-doctor-scapi-'));
  mkdirSync(join(work, 'home'));
  const common = {logsDir: join(FIX, 'logs'), cartridgesDir: join(FIX, 'cartridges'), codeVersion: 'v1', promoBundle: bundle, jobs, maxPage: 5, tenantId: 'zzzz_001'};
  scapiOnly = await startMockSfcc({...common, scapi: 'on', ocapi: false});
  noScopes = await startMockSfcc({...common, scapi: 'forbidden'});
  // both mocks get their own self-signed certificate: trust both
  writeFileSync(join(work, 'ca.pem'), readFileSync(scapiOnly.caFile, 'utf8') + readFileSync(noScopes.caFile, 'utf8'));
  const base = (m: MockSfcc) => ({hostname: m.host, 'account-manager-host': m.host, 'client-id': 'test-client', 'client-secret': 'test-secret', 'short-code': 'abcd1234', 'tenant-id': 'zzzz_001'});
  writeFileSync(
    join(work, 'dw.json'),
    JSON.stringify({
      configs: [
        {name: 'new-prd', ...base(scapiOnly), safety: {level: 'READ_ONLY', rules: [...SCAPI_RULES, ...OCAPI_RULES]}},
        {name: 'new-strict', ...base(scapiOnly), safety: {level: 'READ_ONLY', rules: OCAPI_RULES}},
        {name: 'old-stg', ...base(noScopes), safety: {level: 'READ_ONLY', rules: [...SCAPI_RULES, ...OCAPI_RULES]}},
      ],
    }),
  );
  // the SCAPI redirect needs one host: the SCAPI-only instance (the other one answers 403 via OCAPI fallback test below)
  client = new Client({name: 'scapi-test', version: '0'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', PRELOAD, join(ROOT, 'bin', 'run.js'), 'mcp', '--config', join(work, 'dw.json')],
      env: env(scapiOnly.host),
      stderr: 'pipe',
    }),
  );
});

afterAll(async () => {
  await client?.close();
  await scapiOnly?.close();
  await noScopes?.close();
});

describe('instance with SCAPI only (no OCAPI)', () => {
  it('audit_jobs uses SCAPI job-execution-search and finds the same issues', async () => {
    const r = await call('audit_jobs', {instanceName: 'new-prd'});
    expect(r.isError, r.text).toBeFalsy();
    expect(r.json.target.api).toBe('scapi');
    expect(r.json.findings.map((f: {rule: string; severity: string}) => `${f.rule}:${f.severity}`)).toEqual(['JOB-001:critical', 'JOB-002:medium']);
    expect(r.json.findings[0].evidence[0].location).toBe('Logs/jobs/ExportOrders/Job-ExportOrders-20261008.log');
  });

  it('list_code_versions and audit_code find the active version through SCAPI (dx/scripts)', async () => {
    const versions = await call('list_code_versions', {instanceName: 'new-prd'});
    expect(versions.isError, versions.text).toBeFalsy();
    expect(versions.json.codeVersions.find((v: {active: boolean}) => v.active).id).toBe('v1');
    const code = await call('audit_code', {instanceName: 'new-prd'});
    expect(code.json.target.codeVersion).toBe('v1');
    expect(code.json.summary.findings).toBe(14);
  });

  it('audit_promotions reads promotions, campaigns, assignments, coupons and customer groups through SCAPI', async () => {
    const r = await call('audit_promotions', {instanceName: 'new-prd', site: 'RefArch', currencies: ['EUR']});
    expect(r.isError, r.text).toBeFalsy();
    expect(r.json.target.api).toBe('scapi');
    expect(r.json.data.counts).toEqual({promotions: 14, campaigns: 5, assignments: 14, coupons: 4, customerGroups: 2});
    expect(ruleIds(r.json)).toEqual(analyzePromotions({...bundle, now: r.json.target.now, currencies: ['EUR']}).map((f) => f.rule).sort());
  });

  it('no OCAPI call was needed', () => {
    expect(scapiRequests(scapiOnly).length).toBeGreaterThan(10);
    expect(ocapiRequests(scapiOnly)).toEqual([]);
  });

  it('Safety Mode applies to SCAPI: without the pricing allow rules the searches never leave the machine', async () => {
    const before = scapiRequests(scapiOnly).filter((q) => q.path.includes('/pricing/')).length;
    const r = await call('audit_promotions', {instanceName: 'new-strict', site: 'RefArch'});
    expect(r.isError).toBe(true);
    expect(scapiRequests(scapiOnly).filter((q) => q.path.includes('/pricing/')).length).toBe(before);
  });
});

describe('API client without SCAPI scopes: falls back to OCAPI', () => {
  it('audit_jobs and audit_promotions answer from OCAPI with the same findings', async () => {
    // a second server process, with the SCAPI redirect pointing at the instance that answers 403
    const c = new Client({name: 'fallback-test', version: '0'});
    await c.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', PRELOAD, join(ROOT, 'bin', 'run.js'), 'mcp', '--config', join(work, 'dw.json')],
        env: env(noScopes.host),
        stderr: 'pipe',
      }),
    );
    try {
      const jobsRes = (await c.callTool({name: 'audit_jobs', arguments: {instanceName: 'old-stg'}})) as {content: Array<{text: string}>; isError?: boolean};
      const jobsReport = JSON.parse(jobsRes.content[0].text);
      expect(jobsReport.target.api).toBe('ocapi');
      expect(ruleIds(jobsReport)).toEqual(['JOB-001', 'JOB-002']);
      const promoRes = (await c.callTool({name: 'audit_promotions', arguments: {instanceName: 'old-stg', site: 'RefArch', currencies: ['EUR']}})) as {content: Array<{text: string}>};
      const promo = JSON.parse(promoRes.content[0].text);
      expect(promo.target.api).toBe('ocapi');
      expect(promo.data.counts.promotions).toBe(14);
    } finally {
      await c.close();
    }
    expect(scapiRequests(noScopes).length).toBeGreaterThan(0);
    expect(ocapiRequests(noScopes).length).toBeGreaterThan(0);
  });
});

describe('CLI on a SCAPI-only instance', () => {
  it('audit jobs -i new-prd works without OCAPI', async () => {
    const out = await new Promise<{status: number | null; stdout: string; stderr: string}>((resolve) => {
      const child = spawn(process.execPath, ['--import', PRELOAD, join(ROOT, 'bin', 'run.js'), 'audit', 'jobs', '-i', 'new-prd', '--config', join(work, 'dw.json'), '--json'], {
        env: env(scapiOnly.host),
        cwd: work,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (status) => resolve({status, stdout, stderr}));
    });
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout).target.api).toBe('scapi');
  });
});

describe('never writes', () => {
  it('only GET, PROPFIND, token requests and searches on both instances', () => {
    const search = (p: string) =>
      p.endsWith('_search') ||
      /\/job-execution-search$/.test(p) ||
      /^\/scapi\/pricing\/(promotions|campaigns|coupons)\/v1\/organizations\/[^/]+\/(promotions|campaigns|coupons)$/.test(p);
    for (const m of [scapiOnly, noScopes]) {
      const writes = m.requests.filter((r) => !['GET', 'PROPFIND'].includes(r.method) && !(r.method === 'POST' && (search(r.path) || r.path === '/dwsso/oauth2/access_token')));
      expect(writes).toEqual([]);
    }
  });
});
