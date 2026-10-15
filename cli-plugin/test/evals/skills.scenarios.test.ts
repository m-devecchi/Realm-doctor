/**
 * Scenario evals: for every skill, the tool calls it prescribes are replayed through the real MCP server against the
 * fake instance, and the result is judged against what that skill's report needs.
 *
 * Three layers:
 *  1. rubric       facts the skill's report must be able to state (rules, counts, notes)
 *  2. invariants   rules every tool result must obey (shape, masking, no secrets, known rules)
 *  3. golden       the contract view of each result is stored in golden/*.json; a change shows as a diff
 *                  (update on purpose with `npx vitest run -u test/evals`)
 *
 * A model is not called here: this evaluates what the skills receive and rely on, deterministically.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {auditFrontend, auditPromotions} from '../../src/lib/audits.js';
import {PRIVACY_NOTE} from '../../src/lib/audits.js';
import type {PsiResult} from '../../src/lib/frontend.js';
import {allRules} from '../../src/rules/index.js';
import {bundle, FIX, REPO, startHarness, type Harness} from './harness.js';

const SINCE = '2026-10-01T00:00:00Z';
const SKILLS = readdirSync(join(REPO, '.claude', 'skills')).sort();
const GOLDEN = (n: string) => join('golden', `${n}.json`);

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

type Json = any;
const rulesOf = (r: Json): string[] => (r.findings as Array<{rule: string}>).map((f) => f.rule).sort();

/** The part of a result a skill depends on, without clocks, ports and cache state. */
function contract(r: Json, host: string): unknown {
  const scrub = (v: string) => v.split(host).join('<host>').replace(/\(\d+ from cache\)/, '(N from cache)');
  return {
    command: r.command,
    schemaVersion: r.schemaVersion,
    target: Object.fromEntries(Object.entries(r.target ?? {}).filter(([k]) => !['now'].includes(k)).map(([k, v]) => [k, typeof v === 'string' ? scrub(v) : v])),
    summary: r.summary,
    findings: r.findings.map((f: Json) => ({rule: f.rule, severity: f.severity, title: scrub(f.title), fingerprint: f.fingerprint, where: f.evidence[0]?.location ?? f.evidence[0]?.ref})),
    suppressed: r.suppressed,
    notes: r.notes.map(scrub),
  };
}

// ---------------------------------------------------------------- layer 2: invariants on every result
const SECRET = /test-secret|client-secret/i;
const PII = /@example\.com|93\.184\.216|mario\.rossi|\b\d{9,}\b/i;

function invariants(name: string, r: {isError?: boolean; text: string; json?: Json}): void {
  expect(r.isError, `${name}: ${r.text.slice(0, 200)}`).toBeFalsy();
  expect(r.text, `${name} leaks a secret`).not.toMatch(SECRET);
  expect(r.text, `${name} leaks personal data`).not.toMatch(PII);
  const rep = r.json;
  if (!rep?.findings) return;
  const known = new Set(allRules().map((x) => x.id));
  expect(rep.schemaVersion).toBe(1);
  // the summary counts every finding; a page or a cut list must say so in the notes
  expect(Object.values(rep.summary.bySeverity).reduce((a: number, b) => a + (b as number), 0)).toBe(rep.summary.findings);
  if (rep.summary.findings === rep.findings.length) expect(rep.findings.length).toBe(rep.summary.findings);
  else expect(rep.notes.join(' '), `${name}: a cut list must be declared`).toMatch(/Showing/);
  const prints = new Set<string>();
  for (const f of rep.findings) {
    expect(known.has(f.rule), `${name}: unknown rule ${f.rule}`).toBe(true);
    expect(['critical', 'high', 'medium', 'low']).toContain(f.severity);
    expect(f.impact?.length, `${name} ${f.rule} impact`).toBeGreaterThan(10);
    expect(f.fix?.length, `${name} ${f.rule} fix`).toBeGreaterThan(10);
    expect(f.evidence.length, `${name} ${f.rule} evidence`).toBeGreaterThan(0);
    expect(f.evidence.some((e: Json) => e.location || e.ref), `${name} ${f.rule} needs a location or ref`).toBe(true);
    expect(f.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    prints.add(f.fingerprint);
  }
  expect(prints.size, `${name}: fingerprints must tell findings apart`).toBe(rep.findings.length);
  const order = ['critical', 'high', 'medium', 'low'];
  const sevs = rep.findings.map((f: Json) => order.indexOf(f.severity));
  expect(sevs, `${name}: most severe first`).toEqual([...sevs].sort((a, b) => a - b));
}

// ---------------------------------------------------------------- scenarios, one per skill
interface Scenario {
  skill: string;
  /** tool calls in the order the skill prescribes them */
  steps: Array<{name: string; tool: string; args: Record<string, unknown>; golden?: boolean; expect: (r: Json, all: Record<string, Json>) => void}>;
}

const SCENARIOS: Scenario[] = [
  {
    skill: 'incident-triage',
    steps: [
      {
        // the skill's default is a short window: it must still tell what is new, which needs the days before it
        name: 'errors', tool: 'audit_errors', args: {instanceName: 'mock-sbx', since: '2026-10-08T06:00:00Z', top: 20}, golden: true,
        expect: (r) => {
          expect(r.data.mode).toBe('window');
          expect(rulesOf(r)).toContain('ERR-001');
          expect(r.notes.join(' ')).toMatch(/judged against the 7 days before it/);
          // step 6 of the skill needs a code reference to read: it must be there
          expect(r.findings.some((f: Json) => f.evidence[0].location)).toBe(true);
          expect(r.data.signatures.length).toBeLessThanOrEqual(20);
          expect(r.notes.join(' ')).toContain(PRIVACY_NOTE);
        },
      },
      {name: 'quota', tool: 'audit_quota', args: {instanceName: 'mock-sbx', since: SINCE}, golden: true, expect: (r) => expect(rulesOf(r)).toContain('QUOTA-001')},
      {
        name: 'versions', tool: 'list_code_versions', args: {instanceName: 'mock-sbx'},
        expect: (r) => expect(r.codeVersions.filter((v: Json) => v.active)).toHaveLength(1),
      },
      {name: 'jobs', tool: 'audit_jobs', args: {instanceName: 'mock-sbx', count: 50}, expect: (r) => expect(rulesOf(r)).toContain('JOB-001')},
    ],
  },
  {
    skill: 'quota-audit',
    steps: [
      {
        name: 'quota', tool: 'audit_quota', args: {instanceName: 'mock-sbx', since: SINCE}, golden: true,
        expect: (r) => {
          expect(rulesOf(r)).toEqual(['QUOTA-001', 'QUOTA-002', 'QUOTA-003', 'QUOTA-003']);
          expect(r.findings[0].severity).toBe('critical');
          expect(r.findings[0].evidence[0].excerpt).toMatch(/\(\d+\)/); // locations with counts, to find the code
        },
      },
    ],
  },
  {
    skill: 'job-health',
    steps: [
      {
        name: 'jobs', tool: 'audit_jobs', args: {instanceName: 'mock-sbx'}, golden: true,
        expect: (r) => {
          expect(rulesOf(r)).toEqual(['JOB-001', 'JOB-002']);
          expect(r.findings.find((f: Json) => f.rule === 'JOB-001').severity).toBe('critical'); // ExportOrders handles orders
          expect(r.target.api).toMatch(/^(scapi|ocapi)$/);
        },
      },
      {
        name: 'job log', tool: 'read_instance_file', args: {instanceName: 'mock-sbx', path: 'Logs/jobs/ExportOrders/Job-ExportOrders-20261008.log'},
        // the skill opens the log named by the finding: it must be readable, masked, and name the cause
        expect: (r) => {
          expect(r.content).toContain('HTTP 503');
          expect(r.truncated).toBe(false);
        },
      },
    ],
  },
  {
    skill: 'post-deploy-check',
    steps: [
      {
        // deployed at 08:00; the skill reads the 24 h before and the time after, and needs rates on both sides
        name: 'errors split at the deploy', tool: 'audit_errors', args: {instanceName: 'mock-sbx', since: '2026-10-07T08:00:00Z', splitAt: '2026-10-08T08:00:00Z', top: 50}, golden: true,
        expect: (r) => {
          const sigs = r.data.signatures as Array<{template: string; split: {before: number; after: number; hoursBefore: number; hoursAfter: number; beforePerHour: number; afterPerHour: number}}>;
          expect(sigs.every((s) => s.split)).toBe(true);
          const payment = sigs.find((s) => s.template.startsWith('Payment authorization failed'))!;
          expect(payment.split.before).toBe(0); // new after the deploy
          expect(payment.split.after).toBeGreaterThan(0);
          expect(payment.split).toMatchObject({hoursBefore: 24, hoursAfter: 4});
          expect(payment.split.afterPerHour).toBeGreaterThan(payment.split.beforePerHour);
        },
      },
      {name: 'quota', tool: 'audit_quota', args: {instanceName: 'mock-sbx', since: SINCE}, expect: (r) => expect(r.summary.findings).toBeGreaterThan(0)},
      {name: 'versions', tool: 'list_code_versions', args: {instanceName: 'mock-sbx'}, expect: (r) => expect(r.codeVersions[0].id).toBeTruthy()},
    ],
  },
  {
    skill: 'promo-audit',
    steps: [
      {
        // live call: only the shape; the clock of the instance differs from the fixture
        name: 'promotions', tool: 'audit_promotions', args: {instanceName: 'mock-sbx', site: 'RefArch', currencies: ['EUR']},
        expect: (r) => {
          expect(r.data.counts.promotions).toBe(14);
          expect(r.notes.join(' ')).toMatch(/Product qualifiers and discount rules are not analyzed/);
        },
      },
    ],
  },
  {
    skill: 'frontend-check',
    steps: [], // runs offline, see the dedicated test below
  },
  {
    skill: 'realm-weekly-review',
    steps: [
      {name: 'errors', tool: 'audit_errors', args: {instanceName: 'mock-sbx', since: SINCE, top: 20, maxFindings: 1}, expect: (r) => {
        expect(r.findings).toHaveLength(1);
        expect(r.summary.findings).toBeGreaterThan(1); // the summary still counts everything
        expect(r.notes.join(' ')).toMatch(/Showing the 1 most severe of/);
      }},
      {name: 'quota', tool: 'audit_quota', args: {instanceName: 'mock-sbx', since: SINCE}, expect: (r) => expect(r.summary.bySeverity.critical).toBe(1)},
      {name: 'jobs', tool: 'audit_jobs', args: {instanceName: 'mock-sbx'}, expect: (r) => expect(r.summary.findings).toBe(2)},
      {name: 'promotions', tool: 'audit_promotions', args: {instanceName: 'mock-sbx', site: 'RefArch', currencies: ['EUR']}, expect: (r) => expect(r.summary.findings).toBeGreaterThan(0)},
      {name: 'quota again', tool: 'audit_quota', args: {instanceName: 'mock-sbx', since: SINCE}, expect: () => undefined},
      {
        // "compared with last week" comes from the tool, not from the user's memory
        name: 'compare', tool: 'compare_runs', args: {instanceName: 'mock-sbx', command: 'audit quota'},
        expect: (r) => {
          expect(r.new).toEqual([]);
          expect(r.fixed).toEqual([]);
          expect(r.unchanged.length).toBe(4);
        },
      },
    ],
  },
  {
    skill: 'realm-doctor-setup',
    steps: [
      {
        name: 'instances', tool: 'list_instances', args: {},
        expect: (r) => {
          expect(r.instances[0]).toMatchObject({name: 'mock-sbx', safety: 'READ_ONLY', hasSecret: true});
          expect(Object.keys(r.instances[0]).sort()).toEqual(['active', 'hasSecret', 'hostname', 'name', 'safety']); // nothing else is exposed
        },
      },
      {name: 'rules', tool: 'list_rules', args: {}, expect: (r) => expect(r.rules.length).toBe(allRules().length)},
      {name: 'live read test', tool: 'list_code_versions', args: {instanceName: 'mock-sbx'}, expect: (r) => expect(r.codeVersions.length).toBeGreaterThan(0)},
    ],
  },
];

/** Tools that stay available (quota-audit and job-health use audit_code) but have no skill of their own. */
const TOOL_SCENARIOS: Scenario[] = [
  {
    skill: 'tool-audit-code',
    steps: [
      {
        name: 'code (instance)', tool: 'audit_code', args: {instanceName: 'mock-sbx'}, golden: true,
        expect: (r) => {
          expect(r.target.codeVersion).toBe('v1');
          expect(r.summary.findings).toBe(14);
          expect(r.notes.join(' ')).toMatch(/files analyzed/);
          // the clean cartridge must stay clean
          expect(r.findings.some((f: Json) => f.evidence[0].location.startsWith('app_clean/'))).toBe(false);
        },
      },
      {
        name: 'code (page 2)', tool: 'audit_code', args: {instanceName: 'mock-sbx', maxFindings: 10, offset: 10},
        expect: (r) => {
          expect(r.findings).toHaveLength(4);
          expect(r.notes.join(' ')).not.toMatch(/Pass offset/);
        },
      },
      {name: 'code (page 1)', tool: 'audit_code', args: {instanceName: 'mock-sbx', maxFindings: 10}, expect: (r) => expect(r.notes.join(' ')).toMatch(/Pass offset to read the next page/)},
      {name: 'code (local folder)', tool: 'audit_code', args: {dir: join(FIX, 'cartridges')}, expect: (r) => expect(r.target.origin).toBe('local')},
    ],
  },
  {
    skill: 'tool-audit-hyperforce',
    steps: [
      {
        name: 'hyperforce', tool: 'audit_hyperforce', args: {instanceName: 'mock-sbx'}, golden: true,
        expect: (r) => {
          expect(rulesOf(r)).toEqual(['HF-001', 'HF-002']);
          const status = Object.fromEntries(r.data.checklist.map((c: Json) => [c.item, c.status]));
          expect(Object.values(status)).toContain('FAIL');
          expect(Object.values(status)).toContain('TO CHECK'); // what code cannot prove must stay open
        },
      },
    ],
  },
];

describe('every skill has a scenario', () => {
  it('lists exactly the skills of the repository', () => {
    expect(SCENARIOS.map((s) => s.skill).sort()).toEqual(SKILLS);
  });
});

describe.each([...SCENARIOS, ...TOOL_SCENARIOS].filter((s) => s.steps.length))('eval: $skill', ({skill, steps}) => {
  const results: Record<string, Json> = {};
  for (const step of steps) {
    it(step.name, async (ctx) => {
      const r = await h.call(step.tool, step.args);
      invariants(`${skill}/${step.name}`, r);
      results[step.name] = r.json;
      step.expect(r.json, results);
      if (step.golden) {
        await expect(JSON.stringify(contract(r.json, h.sfcc.host), null, 2) + '\n').toMatchFileSnapshot(GOLDEN(`${skill}.${step.name.replace(/\W+/g, '-')}`));
      }
      void ctx;
    });
  }
});

describe('eval: promo-audit (offline, fixed clock)', () => {
  it('finds the planted problems and keeps the golden contract', async () => {
    const {report} = await auditPromotions(undefined, {site: 'RefArch', bundle: structuredClone(bundle), now: '2026-10-08T12:00:00Z', currencies: ['EUR']});
    invariants('promo-audit/offline', {text: JSON.stringify(report), json: report});
    expect(new Set(rulesOf(report)).size).toBeGreaterThanOrEqual(6);
    await expect(JSON.stringify(contract(report, ''), null, 2) + '\n').toMatchFileSnapshot(GOLDEN('promo-audit.offline'));
  });
});

describe('eval: frontend-check (offline)', () => {
  it('turns a PageSpeed result into findings with the Core Web Vitals the skill reports', async () => {
    const psi = JSON.parse(readFileSync(join(FIX, 'psi', 'home-mobile.json'), 'utf8')) as PsiResult;
    const report = await auditFrontend({urls: ['https://www.example.com/'], psi});
    invariants('frontend-check', {text: JSON.stringify(report), json: report});
    expect(rulesOf(report)).toEqual(['FE-001', 'FE-002', 'FE-005', 'FE-006', 'FE-007']);
    await expect(JSON.stringify(contract(report, ''), null, 2) + '\n').toMatchFileSnapshot(GOLDEN('frontend-check.home'));
  });
});

describe('eval: failures a skill must branch on', () => {
  it('an unknown instance is NOT_FOUND', async () => {
    const r = await h.call('audit_errors', {instanceName: 'nope-prd'});
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Error \[NOT_FOUND\]/);
  });

  it('a path outside Logs/ and Cartridges/ is INVALID_INPUT', async () => {
    const r = await h.call('read_instance_file', {instanceName: 'mock-sbx', path: 'Impex/secret.xml'});
    expect(r.text).toMatch(/^Error \[INVALID_INPUT\]/);
  });

  it('a missing file is NOT_FOUND', async () => {
    const r = await h.call('read_instance_file', {instanceName: 'mock-sbx', path: 'Logs/error-nope-20200101.log'});
    expect(r.text).toMatch(/^Error \[NOT_FOUND\]/);
  });
});

describe('eval: the evals themselves never write to the instance', () => {
  it('only GET, PROPFIND and search POSTs reached the fake instance', () => {
    expect(h.sfcc.requests.length).toBeGreaterThan(20);
    const writes = h.sfcc.requests.filter((q) => !['GET', 'PROPFIND'].includes(q.method) && !(q.method === 'POST' && (q.path.endsWith('_search') || q.path === '/dwsso/oauth2/access_token')));
    expect(writes).toEqual([]);
  });
});
