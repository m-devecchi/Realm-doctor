/**
 * The audits, independent of how they are invoked. The oclif commands and the
 * MCP server both call these functions, so they always produce the same report.
 */
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk';
import {parseSinceTime} from '@salesforce/b2c-tooling-sdk/operations/logs';
import {loadCode} from './code-source.js';
import {aggregateErrors, errorFindings} from './errors.js';
import {frontendFindings, summarizePsi, type FrontendSummary, type PsiResult} from './frontend.js';
import {type Finding} from './finding.js';
import {aggregateQuota, parseQuotaEvent, quotaFindings, type QuotaEvent} from './quota.js';
import {buildReport, type Report} from './report.js';
import {jobFindings, summarizeJobs} from './jobs.js';
import {fetchJobExecutions, fetchLogEntries, fetchPromoBundle} from './sfcc.js';
import {analyzeCode, analyzeHyperforceReadiness} from '../rules/index.js';
import {analyzePromotions, type PromoBundle} from '../rules/promo-rules.js';

export interface Target {
  instance: B2CInstance;
  hostname: string;
}

export interface ErrorsOptions {
  since?: string;
  prefixes?: string[];
  day?: string;
  top?: number;
  maxFiles?: number;
  maxKb?: number;
}

export async function auditErrors(t: Target, o: ErrorsOptions = {}): Promise<Report> {
  const since = parseSinceTime(o.since ?? '24h');
  const prefixes = o.prefixes?.length ? o.prefixes : ['error', 'customerror', 'fatal'];
  const maxKb = o.maxKb ?? 20_480;
  const {entries, files} = await fetchLogEntries(t.instance, t.hostname, {
    prefixes,
    since,
    maxFiles: o.maxFiles ?? 200,
    maxBytesPerFile: maxKb * 1024,
  });
  const signatures = aggregateErrors(entries, {since: since.toISOString()});
  const findings = errorFindings(signatures, {day: o.day});
  const notes: string[] = [];
  if (files.length === 0) notes.push('No log files in the period for the given prefixes.');
  const truncated = files.filter((f) => f.truncated).length;
  if (truncated) notes.push(`${truncated} file(s) read from the tail only (larger than ${maxKb} KB).`);
  return buildReport(
    'audit errors',
    {hostname: t.hostname, since: since.toISOString(), prefixes},
    findings,
    {files: files.length, entries: entries.length, signatures: signatures.slice(0, o.top ?? 30)},
    notes,
  );
}

export interface QuotaOptions {
  since?: string;
  prefixes?: string[];
  maxFiles?: number;
  maxKb?: number;
}

export async function auditQuota(t: Target, o: QuotaOptions = {}): Promise<Report> {
  const since = parseSinceTime(o.since ?? '7d');
  const {entries, files} = await fetchLogEntries(t.instance, t.hostname, {
    prefixes: o.prefixes?.length ? o.prefixes : ['quota'],
    since,
    maxFiles: o.maxFiles ?? 200,
    maxBytesPerFile: (o.maxKb ?? 20_480) * 1024,
  });
  const events = entries
    .filter((e) => !e.timestamp || Date.parse(e.timestamp) >= since.getTime())
    .map(parseQuotaEvent)
    .filter((e): e is QuotaEvent => e !== undefined);
  const summaries = aggregateQuota(events);
  const notes = files.length === 0 ? ['No quota log files in the period: no violations recorded, or missing WebDAV permissions on /Logs.'] : [];
  return buildReport('audit quota', {hostname: t.hostname, since: since.toISOString()}, quotaFindings(summaries), {files: files.length, events: events.length, quotas: summaries}, notes);
}

export interface CodeOptions {
  dir?: string;
  codeVersion?: string;
  cartridges?: string[];
  maxFindings?: number;
}

export async function auditCode(target: (() => Target) | undefined, o: CodeOptions = {}): Promise<Report> {
  const code = await loadCode({dir: o.dir, codeVersion: o.codeVersion, cartridges: o.cartridges}, requireTarget(target));
  const all = analyzeCode(code.files);
  const findings = all.slice(0, o.maxFindings ?? 500);
  const notes = [...code.notes];
  if (all.length > findings.length) notes.push(`Showing ${findings.length} of ${all.length} findings.`);
  return buildReport(
    'audit code',
    {origin: code.origin, codeVersion: code.codeVersion, dir: code.root, cartridges: o.cartridges},
    findings,
    {files: code.files.length, totalFindings: all.length},
    notes,
  );
}

export async function auditHyperforce(target: (() => Target) | undefined, o: Omit<CodeOptions, 'maxFindings'> = {}): Promise<Report> {
  const code = await loadCode({dir: o.dir, codeVersion: o.codeVersion, cartridges: o.cartridges}, requireTarget(target));
  const findings = analyzeHyperforceReadiness(code.files);
  const checklist = [
    {item: 'Hardcoded IPs in code', status: findings.some((f) => f.rule === 'HF-001') ? 'FAIL' : 'OK'},
    {item: 'Hardcoded instance hostnames', status: findings.some((f) => f.rule === 'HF-002') ? 'FAIL' : 'OK'},
    {item: 'IP allowlists on external systems (ERP, PSP, OMS, WAF)', status: 'TO CHECK', note: 'Cannot be verified from code: ask the vendors.'},
    {item: 'Integrations calling SFCC with fixed IPs or hosts', status: 'TO CHECK', note: 'List the inbound systems.'},
    {item: 'mTLS certificates and services in Business Manager', status: 'TO CHECK', note: 'Check the endpoints of the configured services.'},
  ];
  return buildReport('audit hyperforce', {origin: code.origin, codeVersion: code.codeVersion, dir: code.root}, findings, {files: code.files.length, checklist}, code.notes);
}

export interface PromotionsOptions {
  site?: string;
  currencies?: string[];
  now?: string;
  /** analyze this bundle instead of calling the instance */
  bundle?: PromoBundle;
}

export async function auditPromotions(target: (() => Target) | undefined, o: PromotionsOptions): Promise<{report: Report; bundle: PromoBundle}> {
  let bundle: PromoBundle;
  if (o.bundle) bundle = o.bundle;
  else {
    if (!o.site) throw new Error('A site id is required.');
    bundle = await fetchPromoBundle(requireTarget(target)().instance, o.site, o.currencies);
  }
  if (o.now) bundle.now = o.now;
  if (o.currencies?.length) bundle.currencies = o.currencies;
  const findings = analyzePromotions(bundle);
  const notes = ['Product qualifiers and discount rules are not exposed by the APIs: verify them with test baskets (promo-audit skill).'];
  if (!bundle.currencies?.length) notes.push('Currency check skipped: pass the site currencies.');
  const report = buildReport(
    'audit promotions',
    {site: bundle.site, now: bundle.now},
    findings,
    {
      counts: {
        promotions: bundle.promotions.length,
        campaigns: bundle.campaigns.length,
        assignments: bundle.assignments.length,
        coupons: bundle.coupons.length,
        customerGroups: bundle.customerGroups.length,
      },
    },
    notes,
  );
  return {report, bundle};
}

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export interface FrontendOptions {
  urls: string[];
  strategy?: 'mobile' | 'desktop';
  /** analyze a saved PageSpeed response instead of calling the API */
  psi?: PsiResult;
}

export async function auditFrontend(o: FrontendOptions): Promise<Report> {
  const strategy = o.strategy ?? 'mobile';
  const pages: FrontendSummary[] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];
  for (const url of o.urls) {
    let psi = o.psi;
    if (!psi) {
      const q = new URLSearchParams({url, strategy, category: 'performance'});
      if (process.env.PSI_API_KEY) q.set('key', process.env.PSI_API_KEY);
      const res = await fetch(`${PSI}?${q}`);
      if (!res.ok) {
        notes.push(`PageSpeed Insights not available for ${url}: HTTP ${res.status}`);
        continue;
      }
      psi = (await res.json()) as PsiResult;
    }
    const s = summarizePsi(url, psi);
    pages.push(s);
    findings.push(...frontendFindings(s));
  }
  return buildReport('audit frontend', {urls: o.urls, strategy}, findings, {pages}, notes);
}

function requireTarget(target: (() => Target) | undefined): () => Target {
  return () => {
    if (!target) throw new Error('No instance: pass an instance name or a local folder.');
    return target();
  };
}

export interface JobsOptions {
  jobId?: string;
  count?: number;
  now?: string;
}

export async function auditJobs(t: Target, o: JobsOptions = {}): Promise<Report> {
  const executions = await fetchJobExecutions(t.instance, {jobId: o.jobId, count: o.count ?? 100});
  const jobs = summarizeJobs(executions, o.now);
  const notes = executions.length === 0 ? ['No job executions returned: no jobs ran, or the API client lacks POST /job_execution_search.'] : [];
  notes.push('Read a failing job log with read_instance_file (MCP) or `npx b2c job log <jobId> <executionId>`.');
  return buildReport('audit jobs', {hostname: t.hostname, jobId: o.jobId}, jobFindings(jobs), {executions: executions.length, jobs}, notes);
}
