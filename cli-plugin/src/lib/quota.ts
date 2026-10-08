import {type Finding} from './finding.js';
import {type ParsedEntry} from './logparse.js';

/**
 * Quota messages (quota-*.log, also visible in warn logs):
 *   Quota api.jsStringLength (enforced, warn 600000, limit 1000000): warn threshold exceeded 1 time(s),
 *   max actual was 600010, current location: request/site Sites-RefArch-Site/top pipeline Product-Show
 * Variants: "(not enforced, ...)", "limit exceeded N time(s)", object quotas "object.ProductPO.readonly@SF".
 */
const QUOTA_RE =
  /Quota\s+([\w.@]+)\s*\(([^)]*)\)\s*:?\s*(warn threshold|limit)\s+exceeded\s+(\d+)\s+time\(s\)(?:,\s*max actual was\s+(\d+))?(?:,\s*current location:\s*(.*))?/i;

export interface QuotaEvent {
  quota: string;
  enforced: boolean;
  warn?: number;
  limit?: number;
  kind: 'warn' | 'limit';
  times: number;
  maxActual?: number;
  location?: string;
  timestamp?: string;
}

export function parseQuotaEvent(entry: ParsedEntry): QuotaEvent | undefined {
  const text = [entry.message, ...entry.details].join(' ');
  const m = QUOTA_RE.exec(text);
  if (!m) return undefined;
  const props = m[2];
  const enforced = /\benforced\b/i.test(props) && !/not enforced/i.test(props);
  const warn = /warn\s+(\d+)/i.exec(props)?.[1];
  const limit = /limit\s+(\d+)/i.exec(props)?.[1];
  return {
    quota: m[1],
    enforced,
    warn: warn ? Number(warn) : undefined,
    limit: limit ? Number(limit) : undefined,
    kind: m[3].toLowerCase().startsWith('limit') ? 'limit' : 'warn',
    times: Number(m[4]),
    maxActual: m[5] ? Number(m[5]) : undefined,
    location: m[6]?.trim(),
    timestamp: entry.timestamp,
  };
}

export interface QuotaSummary {
  quota: string;
  enforced: boolean;
  warn?: number;
  limit?: number;
  warnExceeded: number;
  limitExceeded: number;
  maxActual?: number;
  /** maxActual / limit, when both are known */
  limitRatio?: number;
  locations: Array<{location: string; count: number}>;
  lastSeen?: string;
}

export function aggregateQuota(events: QuotaEvent[]): QuotaSummary[] {
  const map = new Map<string, QuotaSummary & {_loc: Map<string, number>}>();
  for (const e of events) {
    let s = map.get(e.quota);
    if (!s) {
      s = {quota: e.quota, enforced: e.enforced, warn: e.warn, limit: e.limit, warnExceeded: 0, limitExceeded: 0, locations: [], _loc: new Map()};
      map.set(e.quota, s);
    }
    s.enforced = s.enforced || e.enforced;
    if (e.kind === 'limit') s.limitExceeded += e.times;
    else s.warnExceeded += e.times;
    if (e.maxActual !== undefined) s.maxActual = Math.max(s.maxActual ?? 0, e.maxActual);
    if (e.location) s._loc.set(e.location, (s._loc.get(e.location) ?? 0) + e.times);
    if (e.timestamp && (!s.lastSeen || e.timestamp > s.lastSeen)) s.lastSeen = e.timestamp;
  }
  return [...map.values()]
    .map(({_loc, ...s}) => ({
      ...s,
      limitRatio: s.limit && s.maxActual !== undefined ? round(s.maxActual / s.limit) : undefined,
      locations: [..._loc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([location, count]) => ({location, count})),
    }))
    .sort((a, b) => b.limitExceeded - a.limitExceeded || b.warnExceeded - a.warnExceeded);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function quotaFindings(summaries: QuotaSummary[]): Finding[] {
  const findings: Finding[] = [];
  for (const s of summaries) {
    const evidence = [
      {
        ref: `quota:${s.quota}`,
        data: {
          enforced: s.enforced,
          warn: s.warn,
          limit: s.limit,
          warnExceeded: s.warnExceeded,
          limitExceeded: s.limitExceeded,
          maxActual: s.maxActual,
          limitRatio: s.limitRatio,
        },
        excerpt: s.locations.map((l) => `${l.location} (${l.count})`).join('\n'),
      },
    ];
    if (s.limitExceeded > 0 && s.enforced) {
      findings.push({
        rule: 'QUOTA-001',
        category: 'quota',
        severity: 'critical',
        title: `Quota limit exceeded (enforced): ${s.quota}`,
        evidence,
        impact: `The platform blocked the operation ${s.limitExceeded} times: the affected requests fail.`,
        fix: 'Reduce consumption at the reported location (paging, caching, fewer objects in memory); do not ask for an override as the first option.',
      });
    } else if (s.limitExceeded > 0) {
      findings.push({
        rule: 'QUOTA-002',
        category: 'quota',
        severity: 'high',
        title: `Quota limit exceeded (not enforced yet): ${s.quota}`,
        evidence,
        impact: 'It does not block today, but it becomes a blocking error once the quota is enforced.',
        fix: 'Fix the code at the reported location before the quota becomes enforced.',
      });
    } else if (s.warnExceeded > 0) {
      const near = s.limitRatio !== undefined && s.limitRatio >= 0.8;
      findings.push({
        rule: 'QUOTA-003',
        category: 'quota',
        severity: near ? 'high' : 'medium',
        title: `Warning threshold exceeded: ${s.quota}${near ? ` (at ${Math.round((s.limitRatio ?? 0) * 100)}% of the limit)` : ''}`,
        evidence,
        impact: `Exceeded ${s.warnExceeded} times. A sign of inefficient code that reaches the limit with more traffic or data.`,
        fix: 'Analyze the reported location and reduce consumption.',
      });
    }
  }
  return findings;
}
