import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SafetyGuard} from '@salesforce/b2c-tooling-sdk/safety';
import {afterEach, describe, expect, it} from 'vitest';
import {aggregateErrors, createErrorAggregator, errorFindings} from '../src/lib/errors.js';
import {diffReports} from '../src/lib/diff.js';
import type {Finding} from '../src/lib/finding.js';
import {summarizeJobs, jobFindings} from '../src/lib/jobs.js';
import {maskCodeSecrets} from '../src/lib/mask.js';
import {buildReport} from '../src/lib/report.js';
import {READ_ONLY_ALLOW_RULES, withDefaultRules} from '../src/lib/safety-defaults.js';
import {setSettings} from '../src/lib/settings.js';
import {loadCode} from '../src/lib/code-source.js';
import {analyzeHyperforce} from '../src/rules/hyperforce-rules.js';
import {loadLogs} from './helpers.js';

afterEach(() => setSettings(undefined));
const rulesOf = (f: Finding[]) => f.map((x) => x.rule).sort();

describe('errors: short windows are judged against the days before', () => {
  const entries = loadLogs('error');
  const inLast = (from: string) => entries.filter((e) => (e.timestamp ?? '') >= from);

  it('with only the window read, new errors and spikes cannot be seen (why the baseline is fetched)', () => {
    const last = inLast('2026-10-08T00:00:00Z');
    expect(rulesOf(errorFindings(aggregateErrors(last)))).toEqual(['ERR-003', 'ERR-003']);
  });

  it('with the baseline read, a 6 h window finds the new error and the spike', () => {
    const opts = {since: '2026-10-01T00:00:00Z', windowStart: '2026-10-08T06:00:00Z', until: '2026-10-08T12:00:00Z'};
    const sigs = aggregateErrors(entries, opts);
    const rules = rulesOf(errorFindings(sigs, {windowStart: opts.windowStart, until: opts.until}));
    expect(rules).toContain('ERR-001');
    expect(rules).not.toEqual(['ERR-003', 'ERR-003']);
    for (const f of errorFindings(sigs, {windowStart: opts.windowStart, until: opts.until})) expect(f.impact).toMatch(/last 6 h|never seen/);
  });

  it('counts inside the window only', () => {
    const sigs = aggregateErrors(entries, {since: '2026-10-01T00:00:00Z', windowStart: '2026-10-08T06:00:00Z'});
    for (const s of sigs) expect(s.windowCount).toBeLessThanOrEqual(s.total);
    expect(sigs.reduce((n, s) => n + s.windowCount, 0)).toBe(entries.filter((e) => (e.timestamp ?? '') >= '2026-10-08T06:00:00Z').length);
  });
});

describe('errors: before/after a deployment', () => {
  const entries = loadLogs('error');
  it('gives counts and per-hour rates on both sides of splitAt', () => {
    const agg = createErrorAggregator({since: '2026-10-08T00:00:00Z', windowStart: '2026-10-08T00:00:00Z', splitAt: '2026-10-08T08:00:00Z', until: '2026-10-08T12:00:00Z'});
    agg.add(entries);
    const payment = agg.finish().find((s) => s.template.startsWith('Payment authorization failed'))!;
    expect(payment.split).toMatchObject({at: '2026-10-08T08:00:00Z', before: 0, hoursBefore: 8, hoursAfter: 4, beforePerHour: 0});
    expect(payment.split!.after).toBeGreaterThan(0);
    expect(payment.split!.afterPerHour).toBeCloseTo(payment.split!.after / 4, 1);
    expect(payment.split!.before + payment.split!.after).toBe(payment.windowCount);
  });

  it('has no split without splitAt', () => {
    expect(aggregateErrors(entries)[0].split).toBeUndefined();
  });
});

describe('rules', () => {
  it('HF-002 ignores XML namespaces and documentation links but still finds instance hostnames', () => {
    const xml = '<services xmlns="http://www.demandware.com/xml/impex/services/2014-09-26"/>\n';
    const doc = "var d = 'https://documentation.b2c.commercecloud.salesforce.com/DOC1/x'; var a = 'https://account.demandware.com/';\n";
    expect(analyzeHyperforce({path: 'a/cartridge/x.xml', content: xml})).toEqual([]);
    expect(analyzeHyperforce({path: 'a/cartridge/x.js', content: doc})).toEqual([]);
    const real = "var u = 'https://production-eu01-acme.demandware.net/on/demandware.store';\n";
    expect(analyzeHyperforce({path: 'a/cartridge/x.js', content: real}).map((f) => f.rule)).toEqual(['HF-002']);
  });

  it('JOB-001 is critical for orders, payments, stock and prices, not for any export or import', () => {
    const run = (jobId: string) =>
      jobFindings(summarizeJobs([{id: '1', job_id: jobId, execution_status: 'finished', exit_status: {code: 'ERROR', status: 'error'}, start_time: '2026-10-08T01:00:00Z', duration: 1000}] as never, '2026-10-08T02:00:00Z'))[0].severity;
    expect(run('ExportOrders')).toBe('critical');
    expect(run('PriceBookImport')).toBe('critical');
    expect(run('CatalogImport')).toBe('high');
    expect(run('ExportCategoriesFeed')).toBe('high');
  });
});

describe('code audit defaults to custom cartridges', () => {
  it('skips app_storefront_base, modules and bm_* in a local folder, and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd-base-'));
    for (const c of ['app_custom', 'app_storefront_base', 'modules', 'bm_app_storefront_base']) {
      mkdirSync(join(dir, c, 'cartridge', 'scripts'), {recursive: true});
      writeFileSync(join(dir, c, 'cartridge', 'scripts', 'a.js'), 'try {} catch (e) {}\n');
    }
    const custom = await loadCode({dir}, () => {
      throw new Error('no instance');
    });
    expect(custom.files.map((f) => f.path)).toEqual(['app_custom/cartridge/scripts/a.js']);
    expect(custom.notes.join(' ')).toMatch(/3 file\(s\) in base cartridges.*includeBase/);
    const all = await loadCode({dir, includeBase: true}, () => {
      throw new Error('no instance');
    });
    expect(all.files).toHaveLength(4);
    const named = await loadCode({dir, cartridges: ['app_storefront_base']}, () => {
      throw new Error('no instance');
    });
    expect(named.files.map((f) => f.path)).toEqual(['app_storefront_base/cartridge/scripts/a.js']);
  });
});

describe('safety defaults', () => {
  type Safety = {level?: string; rules?: unknown[]};
  const withRules = (safety: Safety | undefined, raw?: unknown[] | 'unreadable') => withDefaultRules<Safety | undefined>(safety, raw);
  const guard = (rules: unknown[]) => new SafetyGuard({level: 'READ_ONLY', rules: rules as never});
  const post = (path: string) => ({type: 'http' as const, method: 'POST', path});

  it('adds the read rules only when dw.json has no rules key', () => {
    expect(withRules({level: 'READ_ONLY'})?.rules).toHaveLength(READ_ONLY_ALLOW_RULES.length);
    expect(withRules({level: 'READ_ONLY'}, [])?.rules).toBeUndefined(); // "rules": [] is strict
    expect(withRules({level: 'READ_ONLY'}, 'unreadable')?.rules).toBeUndefined();
    expect(withRules({level: 'READ_ONLY', rules: [{action: 'allow'}]})?.rules).toHaveLength(1);
    expect(withRules({level: 'NONE'})?.rules).toBeUndefined();
    expect(withRules(undefined)).toBeUndefined();
  });

  it('allows the searches the audits use and still blocks baskets, authentication and writes', () => {
    const g = guard([...READ_ONLY_ALLOW_RULES]);
    for (const p of ['/s/-/dw/data/v24_5/sites/RefArch/promotion_search', '/s/-/dw/data/v24_5/job_execution_search', '/operation/jobs/v1/organizations/f_ecom_x/job-execution-search', '/pricing/coupons/v1/organizations/f_ecom_x/coupons']) {
      expect(g.evaluate(post(p)).action, p).toBe('allow');
    }
    for (const p of ['/checkout/shopper-baskets/v1/organizations/f_ecom_x/baskets', '/shopper/auth/v1/organizations/f_ecom_x/oauth2/token', '/s/-/dw/data/v24_5/sites/RefArch/promotions']) {
      expect(g.evaluate(post(p)).action, p).toBe('block');
    }
    expect(g.evaluate({type: 'http', method: 'DELETE', path: '/s/-/dw/data/v24_5/code_versions/v1'}).action).toBe('block');
    expect(g.evaluate({type: 'http', method: 'PUT', path: '/Cartridges/v1/a.js'}).action).toBe('block');
  });
});

describe('secrets in code', () => {
  it('hides string credentials and leaves ordinary strings alone', () => {
    const out = maskCodeSecrets("var apiKey = 'sk_live_abcdef123456'; var o = {password: \"hunter2hunter2\", label: 'Checkout', secretName: 'ok'};");
    expect(out).not.toMatch(/sk_live|hunter2/);
    expect(out).toContain("label: 'Checkout'");
    expect(out).toContain("secretName: 'ok'"); // shorter than 6 characters
  });
});

describe('settings keyed by instance name', () => {
  const f = (): Finding => ({rule: 'JS-009', category: 'code', severity: 'low', title: 'Empty catch block', evidence: [{location: 'a/cartridge/x.js:1'}], impact: 'x'.repeat(12), fix: 'y'.repeat(12)});

  it('matches the instance name and the hostname', () => {
    setSettings({settings: {realms: {'acme-prd': {suppress: [{rule: 'JS-009', reason: 'known'}]}}}});
    expect(buildReport('x', {instance: 'acme-prd', hostname: 'production-eu01-acme.demandware.net'}, [f()]).findings).toHaveLength(0);
    expect(buildReport('x', {instance: 'acme-stg', hostname: 'staging-eu01-acme.demandware.net'}, [f()]).findings).toHaveLength(1);
    setSettings({settings: {realms: {'production-eu01-acme': {suppress: [{rule: 'JS-009', reason: 'known'}]}}}});
    expect(buildReport('x', {instance: 'acme-prd', hostname: 'production-eu01-acme.demandware.net'}, [f()]).findings).toHaveLength(0);
  });
});

describe('diff of two reports', () => {
  const finding = (rule: string, ref: string, severity: Finding['severity'], title: string): Finding => ({rule, category: 'errors', severity, title, evidence: [{ref}], impact: 'x'.repeat(12), fix: 'y'.repeat(12)});
  const report = (findings: Finding[], at: string) => ({...buildReport('audit errors', {hostname: 'h'}, findings), generatedAt: at});

  it('tells new, fixed, unchanged and severity changes, ignoring counts in titles', () => {
    const before = report([finding('ERR-003', 'signature:a', 'medium', 'Recurring error (12 occurrences): A'), finding('ERR-001', 'signature:b', 'high', 'New error: B'), finding('ERR-002', 'signature:c', 'high', 'Spike: C')], '2026-10-01T00:00:00Z');
    const after = report([finding('ERR-003', 'signature:a', 'medium', 'Recurring error (97 occurrences): A'), finding('ERR-002', 'signature:c', 'critical', 'Spike: C'), finding('ERR-001', 'signature:d', 'high', 'New error: D')], '2026-10-08T00:00:00Z');
    const d = diffReports(before, after);
    expect(d.unchanged.map((x) => x.where)).toEqual(['signature:a']);
    expect(d.fixed.map((x) => x.where)).toEqual(['signature:b']);
    expect(d.new.map((x) => x.where)).toEqual(['signature:d']);
    expect(d.severityChanged.map((x) => [x.where, x.from, x.severity])).toEqual([['signature:c', 'high', 'critical']]);
  });

  it('refuses reports of different audits and warns about a different scope', () => {
    const a = report([], 'a');
    expect(() => diffReports(a, {...report([], 'b'), command: 'audit quota'})).toThrow(/Cannot compare/);
    const other = {...report([], 'b'), target: {hostname: 'other'}};
    expect(diffReports(a, other).notes.join(' ')).toMatch(/Different hostname/);
  });
});
