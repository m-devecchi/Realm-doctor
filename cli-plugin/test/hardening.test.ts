import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {drainCacheWarnings, readCached, writeCached} from '../src/lib/cache.js';
import {aggregateErrors, createErrorAggregator} from '../src/lib/errors.js';
import {type Finding} from '../src/lib/finding.js';
import {jobFindings} from '../src/lib/jobs.js';
import {maskPII, residualPII} from '../src/lib/mask.js';
import {classifyError, errorText, limitResponse} from '../src/lib/mcp-result.js';
import {buildReport, REPORT_SCHEMA_VERSION} from '../src/lib/report.js';
import {isInlineIgnored, loadSettings, setSettings, thresholds} from '../src/lib/settings.js';
import {analyzeCodeDetailed} from '../src/rules/index.js';
import {analyzeIsml} from '../src/rules/isml-rules.js';
import {loadLogs} from './helpers.js';

afterEach(() => setSettings(undefined));

const finding = (over: Partial<Finding> = {}): Finding => ({
  rule: 'JS-009',
  category: 'code',
  severity: 'low',
  title: 'Empty catch block',
  evidence: [{location: 'int_legacy/cartridge/a.js:10'}],
  impact: 'x',
  fix: 'y',
  ...over,
});

describe('maskPII: new patterns', () => {
  it('masks IBAN, codice fiscale and personal fields', () => {
    const out = maskPII('refund to IT60X0542811101000000123456 for RSSMRA85T10A562S {"firstName":"Mario","lastName":"Rossi","address1":"Via Roma 1"} phone=3331234567 city: Milano');
    expect(out).not.toMatch(/IT60X|RSSMRA85|Mario|Rossi|Via Roma|3331234567|Milano/);
    expect(out).toContain('<IBAN>');
    expect(out).toContain('<TAXID>');
  });

  it('keeps technical text readable', () => {
    const line = 'Job name=ExportOrders failed at 2026-10-08 10:12:33 in step 3';
    expect(maskPII(line)).toBe(line);
  });
});

describe('residualPII (fail closed check)', () => {
  it('is clean on masked text and on normal log lines', () => {
    expect(residualPII(maskPII('mail mario.rossi@example.com from 93.184.216.34 order 000864831'))).toEqual([]);
    expect(residualPII('[2026-10-08 10:12:33.123 GMT] ERROR Cart-AddProduct - Quota exceeded')).toEqual([]);
  });

  it('flags text that still looks personal', () => {
    expect(residualPII('contact mario.rossi@example.com')).toContain('email');
    expect(residualPII('firstName=Mario')).toContain('personal-field');
    expect(residualPII('id 123456789012')).toContain('digits');
  });
});

describe('suppressions and settings', () => {
  it('hides a finding by rule and location, and reports it', () => {
    setSettings({settings: {suppress: [{rule: 'JS-009', location: 'int_legacy/', reason: 'reviewed'}]}});
    const r = buildReport('x', {hostname: 'h'}, [finding(), finding({evidence: [{location: 'app_custom/cartridge/b.js:1'}]})]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence[0].location).toContain('app_custom');
    expect(r.suppressed).toEqual([{rule: 'JS-009', title: 'Empty catch block', reason: 'reviewed'}]);
    expect(r.notes.join(' ')).toMatch(/hidden by suppressions/);
  });

  it('ignores a suppression without a reason and says so', () => {
    setSettings({settings: {suppress: [{rule: 'JS-009'}]}});
    const r = buildReport('x', {}, [finding()]);
    expect(r.findings).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/reason are required/);
  });

  it('per-realm settings apply only to that realm', () => {
    setSettings({settings: {realms: {'prod-realm': {suppress: [{rule: 'JS-009', reason: 'ok'}], thresholds: {jobs: {slowMinutes: 30}}}}}});
    expect(buildReport('x', {hostname: 'prod-realm.example.com'}, [finding()]).findings).toHaveLength(0);
    expect(buildReport('x', {hostname: 'other.example.com'}, [finding()]).findings).toHaveLength(1);
    expect(thresholds('prod-realm.example.com').jobs.slowMinutes).toBe(30);
    expect(thresholds('other.example.com').jobs.slowMinutes).toBe(5);
  });

  it('reads the file named by REALM_DOCTOR_SETTINGS and survives broken JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd-settings-'));
    const file = join(dir, 's.json');
    writeFileSync(file, '{"thresholds": {"errors": {"spikeFactor": 5}}}');
    expect(loadSettings(dir, {REALM_DOCTOR_SETTINGS: file}).settings.thresholds?.errors?.spikeFactor).toBe(5);
    writeFileSync(file, '{ nope');
    const broken = loadSettings(dir, {REALM_DOCTOR_SETTINGS: file});
    expect(broken.settings).toEqual({});
    expect(broken.problems[0]).toMatch(/ignored/);
  });

  it('thresholds change the job findings', () => {
    const summary = {jobId: 'Cleanup', runs: 5, failed: 0, running: 0, lastStatus: 'OK', lastDurationMs: 8 * 60_000, medianDurationMs: 2 * 60_000} as never;
    expect(jobFindings([summary]).map((f) => f.rule)).toContain('JOB-002');
    expect(jobFindings([summary], {slowFactor: 1.5, slowMinutes: 10, stuckFactor: 2})).toEqual([]);
  });

  it('inline ignore on the same line or the line above', () => {
    const src = 'a();\n// realm-doctor-ignore JS-009 legacy\ntry {} catch (e) {}\nb(); // realm-doctor-ignore JS-001, JS-009\n';
    expect(isInlineIgnored(src, 'JS-009', 3)).toBe(true);
    expect(isInlineIgnored(src, 'JS-001', 3)).toBe(false);
    expect(isInlineIgnored(src, 'JS-009', 4)).toBe(true);
    expect(isInlineIgnored(src, 'JS-009', 1)).toBe(false);
  });
});

describe('report format', () => {
  it('has a schema version and stable fingerprints', () => {
    const a = buildReport('x', {}, [finding()]);
    const b = buildReport('x', {}, [finding()]);
    expect(a.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(a.findings[0].fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(a.findings[0].fingerprint).toBe(b.findings[0].fingerprint);
    expect(buildReport('x', {}, [finding({title: 'Other'})]).findings[0].fingerprint).not.toBe(a.findings[0].fingerprint);
  });
});

describe('code analysis', () => {
  const catchFile = {path: 'int_legacy/cartridge/scripts/a.js', content: 'function f() {\n  // realm-doctor-ignore JS-009 known\n  try { g(); } catch (e) {}\n  try { g(); } catch (e) {}\n}\n'};

  it('honours inline ignores and counts them', () => {
    const r = analyzeCodeDetailed([catchFile]);
    expect(r.findings.filter((f) => f.rule === 'JS-009')).toHaveLength(1);
    expect(r.ignoredInline).toBe(1);
  });

  it('reports files with syntax errors instead of staying silent', () => {
    const r = analyzeCodeDetailed([{path: 'a/cartridge/x.js', content: 'function ( {{{ ProductMgr.getProduct('}]);
    expect(r.partial.length + r.failed.length).toBe(1);
  });

  it('does not flag commented code or plain text in ISML', () => {
    const content = [
      '<iscomment>ProductMgr.getProduct(id) was here</iscomment>',
      '<!-- <isprint value="${x}" encoding="off"/> -->',
      '<p>We use OrderMgr terms in the copy</p>',
      '<isloop items="${items}" var="i"><isset name="p" value="${ProductMgr.getProduct(i.id)}" scope="page"/></isloop>',
    ].join('\n');
    const rules = analyzeIsml({path: 'a/cartridge/templates/default/x.isml', content}).map((f) => `${f.rule}:${f.evidence[0].location}`);
    expect(rules).toEqual(['ISML-002:a/cartridge/templates/default/x.isml:4']);
  });

  it('the remote include threshold is configurable', () => {
    const content = '<isinclude url="${u}"/>\n'.repeat(3);
    const f = {path: 'a/cartridge/templates/default/x.isml', content};
    expect(analyzeIsml(f)).toEqual([]);
    expect(analyzeIsml(f, {remoteIncludes: 2}).map((x) => x.rule)).toEqual(['ISML-004']);
  });
});

describe('incremental error aggregation', () => {
  it('gives the same result as aggregating everything at once', () => {
    const entries = loadLogs('error');
    expect(entries.length).toBeGreaterThan(0);
    const agg = createErrorAggregator();
    for (let i = 0; i < entries.length; i += 7) agg.add(entries.slice(i, i + 7));
    expect(agg.finish()).toEqual(aggregateErrors(entries));
  });
});

describe('cache problems are reported, not swallowed', () => {
  it('a missing file is a normal miss; an unreadable one is a warning', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd-cache-'));
    drainCacheWarnings();
    expect(await readCached(join(dir, 'missing'))).toBeUndefined();
    expect(drainCacheWarnings()).toEqual([]);
    // a directory where a file is expected: EISDIR on read, ENOTDIR/EEXIST on write
    expect(await readCached(dir)).toBeUndefined();
    expect(drainCacheWarnings()[0]).toMatch(/Cache read failed \(EISDIR\)/);
    await writeCached(join(dir, 'a', 'b'), 'x');
    writeFileSync(join(dir, 'file'), '');
    await writeCached(join(dir, 'file', 'child'), 'x');
    expect(drainCacheWarnings()[0]).toMatch(/Cache write failed/);
  });
});

describe('MCP results', () => {
  it.each([
    ['Request failed: 401 Unauthorized', 'AUTH_FAILED'],
    ['OCAPI POST /sites/x/promotion_search failed: 404', 'NO_OCAPI'],
    ['File not found: Logs/x.log', 'NOT_FOUND'],
    ['Only paths under Logs/ or Cartridges/ can be read.', 'INVALID_INPUT'],
    ['Blocked by safety: READ_ONLY', 'BLOCKED_BY_SAFETY'],
    ['No dw.json at /x/dw.json', 'CONFIG_ERROR'],
    ['connect ETIMEDOUT 1.2.3.4:443', 'NETWORK'],
    ['something odd', 'INTERNAL'],
  ])('%s -> %s', (message, code) => {
    expect(classifyError(new Error(message)).code).toBe(code);
    expect(errorText(new Error(message))).toBe(`Error [${code}]: ${message}`);
  });

  it('leaves small results alone and cuts big ones, saying so', () => {
    const small = {findings: [1], notes: []};
    expect(limitResponse(small)).toBe(small);
    const findings = Array.from({length: 500}, (_, i) => ({rule: 'JS-001', i, text: 'x'.repeat(200)}));
    const big = {findings, data: {signatures: Array.from({length: 100}, () => ({t: 'y'.repeat(300)}))}, notes: ['n']} as Record<string, unknown>;
    const out = limitResponse(big, 20_000) as {findings: unknown[]; data: {signatures: unknown[]}; notes: string[]; truncated: boolean};
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(20_000);
    expect(out.truncated).toBe(true);
    expect(out.findings.length).toBeLessThan(500);
    expect(out.findings[0]).toEqual(findings[0]);
    expect(out.notes.join(' ')).toMatch(/cut|reduced/);
  });
});
