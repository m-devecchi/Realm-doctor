import {type Finding, type Severity} from './finding.js';
import {extractCodeRefs, type ParsedEntry} from './logparse.js';
import {maskPII} from './mask.js';
import {normalizeMessage, signatureId} from './signature.js';

export interface ErrorSignature {
  id: string;
  template: string;
  level: string;
  total: number;
  /** count per UTC day, YYYY-MM-DD */
  perDay: Record<string, number>;
  firstSeen?: string;
  lastSeen?: string;
  /** top request contexts (site/pipeline) */
  locations: Array<{location: string; count: number}>;
  /** cartridge file references from stack traces */
  codeRefs: Array<{ref: string; count: number}>;
  /** up to 2 masked examples, first line + 5 detail lines */
  examples: string[];
  logPrefixes: string[];
}

export interface AggregateOptions {
  /** ISO date-time; entries before are ignored */
  since?: string;
  /** reference "now" for spike detection, default: latest entry */
  now?: string;
}

export function aggregateErrors(entries: ParsedEntry[], options: AggregateOptions = {}): ErrorSignature[] {
  const since = options.since ? Date.parse(options.since) : undefined;
  const map = new Map<string, ErrorSignature & {_loc: Map<string, number>; _refs: Map<string, number>; _prefix: Set<string>}>();

  for (const e of entries) {
    if (since !== undefined && e.timestamp && Date.parse(e.timestamp) < since) continue;
    const masked = maskPII(e.message);
    const template = normalizeMessage(masked);
    if (!template) continue;
    const id = signatureId(template);
    let sig = map.get(id);
    if (!sig) {
      sig = {
        id,
        template,
        level: e.level ?? 'UNKNOWN',
        total: 0,
        perDay: {},
        locations: [],
        codeRefs: [],
        examples: [],
        logPrefixes: [],
        _loc: new Map(),
        _refs: new Map(),
        _prefix: new Set(),
      };
      map.set(id, sig);
    }
    sig.total++;
    const day = e.timestamp?.slice(0, 10) ?? 'unknown';
    sig.perDay[day] = (sig.perDay[day] ?? 0) + 1;
    if (e.timestamp) {
      if (!sig.firstSeen || e.timestamp < sig.firstSeen) sig.firstSeen = e.timestamp;
      if (!sig.lastSeen || e.timestamp > sig.lastSeen) sig.lastSeen = e.timestamp;
    }
    const loc = [e.site, e.pipeline].filter(Boolean).join(' / ') || 'n/a';
    sig._loc.set(loc, (sig._loc.get(loc) ?? 0) + 1);
    for (const ref of extractCodeRefs(e)) sig._refs.set(ref, (sig._refs.get(ref) ?? 0) + 1);
    sig._prefix.add(prefixOf(e.file));
    if (sig.examples.length < 2) {
      sig.examples.push(maskPII([e.message, ...e.details.slice(0, 5)].join('\n')).slice(0, 1500));
    }
  }

  return [...map.values()]
    .map(({_loc, _refs, _prefix, ...sig}) => ({
      ...sig,
      locations: top(_loc, 5).map(([location, count]) => ({location, count})),
      codeRefs: top(_refs, 5).map(([ref, count]) => ({ref, count})),
      logPrefixes: [..._prefix].sort(),
    }))
    .sort((a, b) => b.total - a.total);
}

function top(m: Map<string, number>, n: number): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function prefixOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  const m = /^(custom-[A-Za-z0-9_]+|[a-z]+)/.exec(base);
  return m ? m[1] : base;
}

export interface SpikeOptions {
  /** day to evaluate, YYYY-MM-DD; default: most recent day in the data */
  day?: string;
  /** spike when count(day) >= factor * average(previous days); default 3 */
  factor?: number;
  /** minimum count on the day to consider a spike; default 10 */
  minCount?: number;
}

/**
 * Turns signatures into findings: new signatures on the evaluated day, spikes,
 * and the top recurring errors.
 */
export function errorFindings(signatures: ErrorSignature[], options: SpikeOptions = {}): Finding[] {
  const factor = options.factor ?? 3;
  const minCount = options.minCount ?? 10;
  const allDays = [...new Set(signatures.flatMap((s) => Object.keys(s.perDay)))].filter((d) => d !== 'unknown').sort();
  const day = options.day ?? allDays.at(-1);
  const previousDays = allDays.filter((d) => day !== undefined && d < day);
  const findings: Finding[] = [];

  for (const s of signatures) {
    const today = day ? s.perDay[day] ?? 0 : s.total;
    const prev = previousDays.map((d) => s.perDay[d] ?? 0);
    const prevTotal = prev.reduce((a, b) => a + b, 0);
    const avg = prev.length ? prevTotal / prev.length : 0;
    const isFatal = s.level === 'FATAL';
    const evidence = [
      {
        ref: `signature:${s.id}`,
        location: s.codeRefs[0]?.ref,
        excerpt: s.examples[0]?.split('\n').slice(0, 3).join('\n'),
        data: {total: s.total, perDay: s.perDay, topLocations: s.locations.slice(0, 3)},
      },
    ];

    if (previousDays.length > 0 && prevTotal === 0 && today > 0) {
      findings.push({
        rule: 'ERR-001',
        category: 'errors',
        severity: sev(isFatal ? 'critical' : today >= minCount ? 'high' : 'medium'),
        title: `New error since ${day}: ${s.template.slice(0, 120)}`,
        evidence,
        impact: `Error never seen in the previous ${previousDays.length} days, ${today} occurrences on ${day}.`,
        fix: 'Check deployments, configuration or data changes of that day; open the file referenced in the stack trace.',
      });
    } else if (today >= minCount && avg > 0 && today >= factor * avg) {
      findings.push({
        rule: 'ERR-002',
        category: 'errors',
        severity: sev(isFatal ? 'critical' : 'high'),
        title: `Error spike: ${s.template.slice(0, 120)}`,
        evidence,
        impact: `${today} occurrences on ${day} against an average of ${avg.toFixed(1)} per day (x${(today / avg).toFixed(1)}).`,
        fix: 'Correlate with deployments, jobs or campaigns of that day; check the code line referenced in the stack trace.',
      });
    }
  }

  // Top recurring errors (volume), independent of trend
  for (const s of signatures.slice(0, 5)) {
    if (findings.some((f) => f.evidence[0]?.ref === `signature:${s.id}`)) continue;
    if (s.total < minCount) continue;
    findings.push({
      rule: 'ERR-003',
      category: 'errors',
      severity: s.level === 'FATAL' ? 'critical' : 'medium',
      title: `Recurring error (${s.total} occurrences): ${s.template.slice(0, 120)}`,
      evidence: [
        {
          ref: `signature:${s.id}`,
          location: s.codeRefs[0]?.ref,
          excerpt: s.examples[0]?.split('\n').slice(0, 3).join('\n'),
          data: {total: s.total, perDay: s.perDay, topLocations: s.locations.slice(0, 3)},
        },
      ],
      impact: 'Constant error over the period: log noise and possible impact on conversion or performance.',
      fix: 'Fix the cause in the referenced code or, if expected, lower the log level.',
    });
  }
  return findings;
}

function sev(s: Severity): Severity {
  return s;
}
