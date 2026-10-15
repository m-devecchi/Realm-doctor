/** Compares two reports of the same audit: what is new, fixed, still open, or changed severity. */
import type {Finding, Severity} from './finding.js';
import type {Report} from './report.js';

export interface FindingRef {
  fingerprint: string;
  rule: string;
  severity: Severity;
  title: string;
  where?: string;
}

export interface ReportDiff {
  command: string;
  before: {generatedAt: string; findings: number};
  after: {generatedAt: string; findings: number};
  new: FindingRef[];
  fixed: FindingRef[];
  unchanged: FindingRef[];
  severityChanged: Array<FindingRef & {from: Severity}>;
  notes: string[];
}

const ref = (f: Finding): FindingRef => ({
  fingerprint: f.fingerprint ?? '',
  rule: f.rule,
  severity: f.severity,
  title: f.title,
  where: f.evidence[0]?.ref ?? f.evidence[0]?.location,
});

type Comparable = Pick<Report, 'command' | 'generatedAt' | 'findings' | 'target' | 'schemaVersion'>;

export function diffReports(before: Comparable, after: Comparable): ReportDiff {
  const notes: string[] = [];
  if (before.command !== after.command) throw new Error(`Cannot compare "${before.command}" with "${after.command}".`);
  if (before.schemaVersion !== after.schemaVersion) notes.push(`Report formats differ (${before.schemaVersion} vs ${after.schemaVersion}): fingerprints may not match.`);
  for (const key of ['site', 'jobId', 'codeVersion', 'hostname']) {
    if (before.target?.[key] !== after.target?.[key]) notes.push(`Different ${key}: ${String(before.target?.[key])} vs ${String(after.target?.[key])}. The comparison may not be meaningful.`);
  }
  if (before.findings.some((f) => !f.fingerprint) || after.findings.some((f) => !f.fingerprint)) notes.push('Some findings have no fingerprint: they are reported as new or fixed.');

  const old = new Map(before.findings.map((f) => [f.fingerprint, f]));
  const current = new Map(after.findings.map((f) => [f.fingerprint, f]));
  const diff: ReportDiff = {
    command: after.command,
    before: {generatedAt: before.generatedAt, findings: before.findings.length},
    after: {generatedAt: after.generatedAt, findings: after.findings.length},
    new: [],
    fixed: [],
    unchanged: [],
    severityChanged: [],
    notes,
  };
  for (const f of after.findings) {
    const was = f.fingerprint ? old.get(f.fingerprint) : undefined;
    if (!was) diff.new.push(ref(f));
    else if (was.severity !== f.severity) diff.severityChanged.push({...ref(f), from: was.severity});
    else diff.unchanged.push(ref(f));
  }
  for (const f of before.findings) if (!f.fingerprint || !current.has(f.fingerprint)) diff.fixed.push(ref(f));
  return diff;
}
