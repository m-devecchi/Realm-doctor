import {countBySeverity, sortFindings, type Finding, type Severity} from './finding.js';

export interface Report<D = unknown> {
  tool: 'realm-doctor';
  command: string;
  generatedAt: string;
  target: Record<string, unknown>;
  summary: {findings: number; bySeverity: Record<Severity, number>};
  findings: Finding[];
  data?: D;
  notes: string[];
}

export function buildReport<D>(command: string, target: Record<string, unknown>, findings: Finding[], data?: D, notes: string[] = []): Report<D> {
  const sorted = sortFindings(findings);
  return {
    tool: 'realm-doctor',
    command,
    generatedAt: new Date().toISOString(),
    target,
    summary: {findings: sorted.length, bySeverity: countBySeverity(sorted)},
    findings: sorted,
    data,
    notes,
  };
}

const LABEL: Record<Severity, string> = {critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW'};

/** Human-readable output when --json is not set. */
export function formatReport(report: Report, limit = 50): string {
  const lines: string[] = [];
  const s = report.summary.bySeverity;
  lines.push(`realm-doctor ${report.command} · ${JSON.stringify(report.target)}`);
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
