/**
 * End-to-end: starts `realm-doctor mcp` over stdio with a real MCP client, a
 * multi-instance dw.json and the fake HTTPS instance. Checks the tools, the
 * per-call instance selection, Safety Mode per instance, masking and that
 * nothing is ever written to the instance.
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
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
let client: Client;

const allow = [
  {method: 'POST', path: '/s/-/dw/data/*/sites/*/*_search', action: 'allow'},
  {method: 'POST', path: '/s/-/dw/data/*/job_execution_search', action: 'allow'},
];

async function call(name: string, args: Record<string, unknown> = {}): Promise<{isError?: boolean; text: string; json?: any}> {
  const res = (await client.callTool({name, arguments: args})) as {isError?: boolean; content: Array<{type: string; text: string}>};
  const text = res.content.map((c) => c.text).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {isError: res.isError, text, json};
}

const ruleIds = (r?: Report) => (r?.findings ?? []).map((f) => f.rule).sort();

beforeAll(async () => {
  if (!existsSync(join(ROOT, 'dist', 'commands', 'mcp.js'))) throw new Error('Run `npm run build` first.');
  work = mkdtempSync(join(tmpdir(), 'realm-doctor-mcp-'));
  mkdirSync(join(work, 'home'));
  sfcc = await startMockSfcc({
    logsDir: join(FIX, 'logs'),
    cartridgesDir: join(FIX, 'cartridges'),
    codeVersion: 'v1',
    promoBundle: bundle,
    jobs: JSON.parse(readFileSync(join(FIX, 'jobs', 'executions.json'), 'utf8')),
    maxPage: 5,
  });
  const base = {hostname: sfcc.host, 'account-manager-host': sfcc.host, 'client-id': 'test-client'};
  // dw.json outside any project, as the plugin uses it
  writeFileSync(
    join(work, 'dw.json'),
    JSON.stringify({
      configs: [
        {name: 'mock-sbx', active: true, ...base, 'client-secret': 'test-secret', safety: {level: 'READ_ONLY', rules: allow}},
        {name: 'mock-strict', ...base, 'client-secret': 'test-secret', safety: {level: 'READ_ONLY'}},
        {name: 'mock-envsecret', ...base, safety: {level: 'READ_ONLY', rules: allow}},
      ],
    }),
  );
  client = new Client({name: 'realm-doctor-test', version: '0.0.0'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(ROOT, 'bin', 'run.js'), 'mcp', '--config', join(work, 'dw.json')],
      cwd: tmpdir(),
      stderr: 'pipe',
      env: {
        ...(process.env as Record<string, string>),
        HOME: join(work, 'home'),
        NODE_EXTRA_CA_CERTS: sfcc.caFile,
        NO_PROXY: 'localhost,127.0.0.1',
        no_proxy: 'localhost,127.0.0.1',
        REALM_DOCTOR_CACHE: join(work, 'cache'),
        SFCC_CLIENT_SECRET: 'test-secret',
        SFCC_SAFETY_CONFIG: '',
      },
    }),
  );
});

afterAll(async () => {
  await client?.close();
  await sfcc?.close();
});

describe('realm-doctor MCP server', () => {
  it('exposes the read-only tools', async () => {
    const {tools} = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'audit_code',
      'audit_errors',
      'audit_frontend',
      'audit_hyperforce',
      'audit_jobs',
      'audit_promotions',
      'audit_quota',
      'list_code_versions',
      'list_instances',
      'list_rules',
      'read_instance_file',
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    const errors = tools.find((t) => t.name === 'audit_errors')!;
    expect(Object.keys(errors.inputSchema.properties ?? {})).toContain('instanceName');
  });

  it('list_instances: every instance, never a secret', async () => {
    const r = await call('list_instances');
    expect(r.isError).toBeFalsy();
    expect(r.json.instances.map((i: {name: string}) => i.name)).toEqual(['mock-sbx', 'mock-strict', 'mock-envsecret']);
    expect(r.json.instances[0]).toMatchObject({active: true, safety: 'READ_ONLY', hasSecret: true});
    expect(r.text).not.toContain('test-secret');
  });

  it('audit_errors on a named instance: same result as the CLI, data masked', async () => {
    const r = await call('audit_errors', {instanceName: 'mock-sbx', since: '2026-10-01T00:00:00Z'});
    expect(r.isError, r.text).toBeFalsy();
    expect(r.json.target.instance).toBe('mock-sbx');
    expect(ruleIds(r.json)).toEqual(['ERR-001', 'ERR-002']);
    expect(r.json.data.entries).toBe(78);
    expect(r.text).not.toMatch(/@example\.com|93\.184\.216/);
  });

  it('audit_quota, audit_jobs, audit_code, audit_hyperforce', async () => {
    const quota = await call('audit_quota', {instanceName: 'mock-sbx', since: '2026-10-01T00:00:00Z'});
    expect(ruleIds(quota.json)).toEqual(['QUOTA-001', 'QUOTA-002', 'QUOTA-003', 'QUOTA-003']);
    const jobs = await call('audit_jobs', {instanceName: 'mock-sbx'});
    expect(ruleIds(jobs.json)).toEqual(['JOB-001', 'JOB-002']);
    const code = await call('audit_code', {instanceName: 'mock-sbx'});
    expect(code.json.target.codeVersion).toBe('v1');
    expect(code.json.summary.findings).toBe(14);
    const hf = await call('audit_hyperforce', {instanceName: 'mock-sbx'});
    expect(ruleIds(hf.json)).toEqual(['HF-001', 'HF-002']);
  });

  it('audit_code on a local folder needs no instance', async () => {
    const r = await call('audit_code', {dir: join(FIX, 'cartridges')});
    expect(r.isError, r.text).toBeFalsy();
    expect(r.json.summary.findings).toBe(14);
  });

  it('audit_promotions matches the offline analysis', async () => {
    const r = await call('audit_promotions', {instanceName: 'mock-sbx', site: 'RefArch', currencies: ['EUR']});
    expect(r.isError, r.text).toBeFalsy();
    expect(r.json.data.counts.promotions).toBe(14);
    // the live "now" differs from the fixture date: compare with the same clock
    expect(ruleIds(r.json)).toEqual(analyzePromotions({...bundle, now: r.json.target.now, currencies: ['EUR']}).map((f) => f.rule).sort());
  });

  it('the secret can come from SFCC_CLIENT_SECRET', async () => {
    const r = await call('list_code_versions', {instanceName: 'mock-envsecret'});
    expect(r.isError, r.text).toBeFalsy();
    expect(r.json.codeVersions.find((v: {active: boolean}) => v.active).id).toBe('v1');
  });

  it('read_instance_file reads a job log masked, and refuses paths outside Logs/ and Cartridges/', async () => {
    const r = await call('read_instance_file', {instanceName: 'mock-sbx', path: 'Logs/jobs/ExportOrders/Job-ExportOrders-20261008.log'});
    expect(r.isError, r.text).toBeFalsy();
    expect(r.json.content).toContain('HTTP 503');
    expect(r.json.content).not.toMatch(/mario\.rossi|00012345678/);
    const bad = await call('read_instance_file', {instanceName: 'mock-sbx', path: 'Impex/../Logs/x.log'});
    expect(bad.isError).toBe(true);
  });

  it("each call uses its instance's Safety Mode: searches blocked on mock-strict before reaching the instance", async () => {
    const before = sfcc.requests.filter((q) => q.path.endsWith('_search')).length;
    const r = await call('audit_promotions', {instanceName: 'mock-strict', site: 'RefArch'});
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/safety|blocked|READ_ONLY/i);
    expect(sfcc.requests.filter((q) => q.path.endsWith('_search')).length).toBe(before);
    // the next call on the other instance still works
    expect((await call('audit_jobs', {instanceName: 'mock-sbx'})).isError).toBeFalsy();
  });

  it('unknown instance: clear error', async () => {
    const r = await call('audit_errors', {instanceName: 'nope-prd'});
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/nope-prd/);
  });

  it('never writes to the instance', () => {
    expect(sfcc.requests.length).toBeGreaterThan(20);
    const writes = sfcc.requests.filter(
      (r) => !['GET', 'PROPFIND'].includes(r.method) && !(r.method === 'POST' && (r.path.endsWith('_search') || r.path === '/dwsso/oauth2/access_token')),
    );
    expect(writes).toEqual([]);
  });
});
