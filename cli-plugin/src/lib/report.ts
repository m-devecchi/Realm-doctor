import {createHash} from 'node:crypto';
import {applySuppressions} from './settings.js';
import {countBySeverity, sortFindings, type Finding, type Severity} from './finding.js';

/** Bump when the shape of the JSON report changes, so saved reports can be compared safely. */
export const REPORT_SCHEMA_VERSION = 1;

export interface Report<D = unknown> {
  schemaVersion: number;
  tool: 'realm-doctor';
  command: string;
  generatedAt: string;
  target: Record<string, unknown>;
  summary: {findings: number; bySeverity: Record<Severity, number>};
  findings: Finding[];
  /** findings hidden by a suppression in realm-doctor.json or an inline realm-doctor-ignore comment */
  suppressed: Array<{rule: string; title: string; reason: string}>;
  data?: D;
  notes: string[];
}

export function buildReport<D>(command: string, target: Record<string, unknown>, findings: Finding[], data?: D, notes: string[] = []): Report<D> {
  const realm = [target.instance, target.hostname].filter((k): k is string => typeof k === 'string');
  const {kept, suppressed, problems} = applySuppressions(findings, realm);
  const sorted = sortFindings(kept).map((f) => ({...f, fingerprint: fingerprint(f)}));
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: 'realm-doctor',
    command,
    generatedAt: new Date().toISOString(),
    target,
    summary: {findings: sorted.length, bySeverity: countBySeverity(sorted)},
    findings: sorted,
    suppressed,
    data,
    notes: [...notes, ...problems, ...(suppressed.length ? [`${suppressed.length} finding(s) hidden by suppressions (see "suppressed").`] : [])],
  };
}

/**
 * Stable id of a finding across runs. When the finding has a ref (an error signature, a job, a quota, a promotion) the
 * ref plus the title without its numbers is the identity, because titles carry counts that change every run. For code findings
 * the identity is the place and the title (the API or pattern found there).
 */
export function fingerprint(f: Finding): string {
  const refs = f.evidence.map((e) => e.ref).filter(Boolean);
  // digits in a title are counts, durations and percentages that change every run
  const key = refs.length ? `${refs.join(',')}|${f.title.replace(/\d+(\.\d+)?/g, '#')}` : `${f.evidence.map((e) => e.location ?? '').join(',')}|${f.title}`;
  return createHash('sha1').update(`${f.rule}|${key}`).digest('hex').slice(0, 12);
}

const LABEL: Record<Severity, string> = {critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW'};

/** Human-readable output when --json is not set. */
export function formatReport(report: Report, limit = 50): string {
  const lines: string[] = [];
  const s = report.summary.bySeverity;
  lines.push(`realm-doctor ${report.command} · ${JSON.stringify(report.target)}`);
  if (report.suppressed.length) lines.push(`Suppressed: ${report.suppressed.length}`);
  lines.push(`Findings: ${report.summary.findings} (critical ${s.critical}, high ${s.high}, medium ${s.medium}, low ${s.low})`);
  for (const n of report.notes) lines.push(`Note: ${n}`);
  lines.push('');
  for (const f of report.findings.slice(0, limit)) {
    lines.push(`[${LABEL[f.severity]}] ${f.rule} ${f.title}`);
    for (const e of f.evidence.slice(0, 2)) {
      if (e.location) lines.push(`  where: ${e.location}`);
      if (e.ref) lines.push(`  ref: ${e.ref}`);
      if (e.excerpt) lines.push(`  ${e.excerpt.split('\n')[0]}`);
    }
    lines.push(`  impact: ${f.impact}`);
    lines.push(`  fix: ${f.fix}`);
    lines.push('');
  }
  if (report.findings.length > limit) lines.push(`... ${report.findings.length - limit} more findings (use --json for the full list)`);
  return lines.join('\n');
}
