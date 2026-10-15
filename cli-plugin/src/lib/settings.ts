/**
 * Optional per-project settings: thresholds and suppressions, so a known and accepted
 * finding does not come back in every review.
 *
 * File: REALM_DOCTOR_SETTINGS, else ./realm-doctor.json, else ./config/realm-doctor.json
 * (relative to the folder the audit runs from). Missing file = defaults.
 *
 *   {
 *     "thresholds": {"errors": {"spikeFactor": 4}, "jobs": {"slowMinutes": 10}},
 *     "suppress": [{"rule": "JS-009", "location": "int_legacy/", "reason": "reviewed 2026-10"}],
 *     "realms": {"myrealm-prd": {"thresholds": {...}, "suppress": [...]}}
 *   }
 *
 * A suppression matches when `rule` is equal and, if given, `location` or `ref` is contained in the
 * finding's evidence. `reason` is required: a suppression without a reason is ignored and reported.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {Finding} from './finding.js';

export interface Thresholds {
  errors: {spikeFactor: number; minCount: number};
  jobs: {slowFactor: number; slowMinutes: number; stuckFactor: number};
  quota: {warnRatio: number};
  code: {remoteIncludes: number};
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  errors: {spikeFactor: 3, minCount: 10},
  jobs: {slowFactor: 1.5, slowMinutes: 5, stuckFactor: 2},
  quota: {warnRatio: 0.8},
  code: {remoteIncludes: 5},
};

export interface Suppression {
  rule: string;
  location?: string;
  ref?: string;
  reason?: string;
}

type DeepPartial<T> = {[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]};

export interface Settings {
  thresholds?: DeepPartial<Thresholds>;
  suppress?: Suppression[];
  realms?: Record<string, {thresholds?: DeepPartial<Thresholds>; suppress?: Suppression[]}>;
}

let current: {settings: Settings; source?: string; problems: string[]} | undefined;

function settingsPath(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.REALM_DOCTOR_SETTINGS) return resolve(env.REALM_DOCTOR_SETTINGS);
  return [join(cwd, 'realm-doctor.json'), join(cwd, 'config', 'realm-doctor.json')].find((p) => existsSync(p));
}

export function loadSettings(cwd?: string, env?: NodeJS.ProcessEnv): {settings: Settings; source?: string; problems: string[]} {
  const file = settingsPath(cwd, env);
  if (!file || !existsSync(file)) return {settings: {}, problems: []};
  try {
    return {settings: JSON.parse(readFileSync(file, 'utf8')) as Settings, source: file, problems: []};
  } catch (error) {
    return {settings: {}, source: file, problems: [`Settings file ${file} ignored: ${error instanceof Error ? error.message : String(error)}`]};
  }
}

export function getSettings(): {settings: Settings; source?: string; problems: string[]} {
  current ??= loadSettings();
  return current;
}

/** for tests and for callers that load settings from another folder */
export function setSettings(s: {settings: Settings; source?: string; problems?: string[]} | undefined): void {
  current = s && {problems: [], ...s};
}

function merge<T extends object>(base: T, over: DeepPartial<T> | undefined): T {
  const out = {...base} as Record<string, unknown>;
  for (const [k, v] of Object.entries(over ?? {})) {
    const b = out[k];
    if (v && typeof v === 'object' && b && typeof b === 'object') out[k] = merge(b as object, v as object);
    else if (typeof v === typeof b) out[k] = v;
  }
  return out as T;
}

/** realm = instance name or hostname */
function realmEntry(realm?: string) {
  const realms = getSettings().settings.realms ?? {};
  return realm ? Object.entries(realms).find(([k]) => realm === k || realm.startsWith(`${k}.`))?.[1] : undefined;
}

export function thresholds(realm?: string): Thresholds {
  const s = getSettings().settings;
  return merge(merge(DEFAULT_THRESHOLDS, s.thresholds), realmEntry(realm)?.thresholds);
}

export interface SuppressionResult {
  kept: Finding[];
  suppressed: Array<{rule: string; title: string; reason: string}>;
  problems: string[];
}

const evidenceText = (f: Finding, key: 'location' | 'ref'): string[] => f.evidence.map((e) => e[key]).filter((v): v is string => Boolean(v));

export function applySuppressions(findings: Finding[], realm?: string): SuppressionResult {
  const s = getSettings();
  const rules = [...(s.settings.suppress ?? []), ...(realmEntry(realm)?.suppress ?? [])];
  const problems = [...s.problems];
  const valid: Suppression[] = [];
  for (const r of rules) {
    if (!r.rule || !r.reason?.trim()) problems.push(`Suppression ignored (rule and reason are required): ${JSON.stringify(r)}`);
    else valid.push(r);
  }
  const kept: Finding[] = [];
  const suppressed: SuppressionResult['suppressed'] = [];
  for (const f of findings) {
    const hit = valid.find(
      (r) =>
        r.rule === f.rule &&
        (!r.location || evidenceText(f, 'location').some((l) => l.includes(r.location!))) &&
        (!r.ref || evidenceText(f, 'ref').some((l) => l.includes(r.ref!))),
    );
    if (hit) suppressed.push({rule: f.rule, title: f.title, reason: hit.reason!});
    else kept.push(f);
  }
  return {kept, suppressed, problems};
}

/** `// realm-doctor-ignore JS-009 reason` on the line of the finding or the line above (also in ISML comments). */
const INLINE = /realm-doctor-ignore\s+([A-Z]+-\d{3}(?:\s*,\s*[A-Z]+-\d{3})*)/;

export function isInlineIgnored(content: string, rule: string, line: number): boolean {
  const lines = content.split('\n');
  for (const l of [lines[line - 1], lines[line - 2]]) {
    const m = l ? INLINE.exec(l) : null;
    if (m && m[1].split(/\s*,\s*/).includes(rule)) return true;
  }
  return false;
}
