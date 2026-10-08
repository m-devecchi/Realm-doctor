/**
 * Shared finding model. Every audit command emits findings in this shape so the
 * Claude skills can render them with one template.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Category =
  | 'errors'
  | 'quota'
  | 'code'
  | 'hyperforce'
  | 'promotions'
  | 'frontend'
  | 'jobs';

export interface Evidence {
  /** Error signature id, job id, promotion id, URL... */
  ref?: string;
  /** file:line inside a cartridge, when known */
  location?: string;
  /** Short, already-masked excerpt that proves the finding */
  excerpt?: string;
  /** Free-form structured data (counts, dates, thresholds) */
  data?: Record<string, unknown>;
}

export interface Finding {
  /** Stable rule id, e.g. "JS-001" or "PROMO-004" */
  rule: string;
  category: Category;
  severity: Severity;
  title: string;
  evidence: Evidence[];
  /** What happens on the storefront or for the business */
  impact: string;
  /** Concrete fix: where and what to change */
  fix: string;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule.localeCompare(b.rule),
  );
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {critical: 0, high: 0, medium: 0, low: 0};
  for (const f of findings) counts[f.severity]++;
  return counts;
}
