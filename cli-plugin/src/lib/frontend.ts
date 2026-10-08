import {type Finding} from './finding.js';

/**
 * Analysis of a PageSpeed Insights v5 response (runPagespeed).
 * Field data (CrUX) wins over lab data when present.
 * Thresholds: Core Web Vitals "good" limits published by Google.
 */
export interface PsiResult {
  id?: string;
  loadingExperience?: {
    metrics?: Record<string, {percentile?: number; category?: string}>;
    overall_category?: string;
  };
  lighthouseResult?: {
    finalUrl?: string;
    audits?: Record<string, {numericValue?: number; score?: number | null; displayValue?: string; details?: {items?: Array<Record<string, unknown>>}}>;
    categories?: Record<string, {score?: number | null}>;
  };
}

export interface FrontendSummary {
  url: string;
  source: 'field' | 'lab';
  lcpMs?: number;
  cls?: number;
  inpMs?: number;
  tbtMs?: number;
  totalBytes?: number;
  jsBytes?: number;
  thirdPartyBlockingMs?: number;
  performanceScore?: number;
  consoleErrors: string[];
  topThirdParties: Array<{entity: string; blockingMs: number; transferBytes: number}>;
}

const LIMITS = {
  lcp: {good: 2500, poor: 4000},
  cls: {good: 0.1, poor: 0.25},
  inp: {good: 200, poor: 500},
  tbt: {good: 200, poor: 600},
  totalBytes: 3_000_000,
  jsBytes: 1_000_000,
  thirdPartyBlockingMs: 250,
};

export function summarizePsi(url: string, psi: PsiResult): FrontendSummary {
  const field = psi.loadingExperience?.metrics ?? {};
  const audits = psi.lighthouseResult?.audits ?? {};
  const hasField = field.LARGEST_CONTENTFUL_PAINT_MS?.percentile !== undefined;
  const n = (id: string) => audits[id]?.numericValue;

  const jsBytes = (audits['resource-summary']?.details?.items ?? [])
    .filter((i) => i.resourceType === 'script')
    .reduce((acc, i) => acc + Number(i.transferSize ?? 0), 0);

  const thirdParties = (audits['third-party-summary']?.details?.items ?? [])
    .map((i) => ({
      entity:
        i.entity && typeof i.entity === 'object'
          ? String((i.entity as {text?: string}).text ?? '?')
          : String(i.entity ?? '?'),
      blockingMs: Math.round(Number(i.blockingTime ?? 0)),
      transferBytes: Number(i.transferSize ?? 0),
    }))
    .sort((a, b) => b.blockingMs - a.blockingMs);

  const consoleErrors = (audits['errors-in-console']?.details?.items ?? [])
    .map((i) => String(i.description ?? '').slice(0, 200))
    .filter(Boolean)
    .slice(0, 10);

  const score = psi.lighthouseResult?.categories?.performance?.score;
  return {
    url: psi.lighthouseResult?.finalUrl ?? url,
    source: hasField ? 'field' : 'lab',
    lcpMs: hasField ? field.LARGEST_CONTENTFUL_PAINT_MS?.percentile : n('largest-contentful-paint'),
    cls: hasField
      ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile !== undefined
        ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
        : undefined
      : n('cumulative-layout-shift'),
    inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile,
    tbtMs: n('total-blocking-time'),
    totalBytes: n('total-byte-weight'),
    jsBytes: jsBytes || undefined,
    thirdPartyBlockingMs: thirdParties.reduce((a, t) => a + t.blockingMs, 0) || undefined,
    performanceScore: typeof score === 'number' ? Math.round(score * 100) : undefined,
    consoleErrors,
    topThirdParties: thirdParties.slice(0, 5),
  };
}

export function frontendFindings(s: FrontendSummary): Finding[] {
  const out: Finding[] = [];
  const ref = s.url;
  const src = s.source === 'field' ? 'dati reali utenti (CrUX, 75° percentile)' : 'misura di laboratorio (Lighthouse)';
  const metric = (rule: string, name: string, value: number | undefined, lim: {good: number; poor: number}, unit: string, impact: string, fix: string) => {
    if (value === undefined || value <= lim.good) return;
    out.push({
      rule,
      category: 'frontend',
      severity: value > lim.poor ? 'high' : 'medium',
      title: `${name} ${value > lim.poor ? 'scarso' : 'da migliorare'}: ${fmt(value, unit)} (soglia ${fmt(lim.good, unit)})`,
      evidence: [{ref, data: {value, good: lim.good, poor: lim.poor, source: src}}],
      impact,
      fix,
    });
  };
  metric('FE-001', 'LCP', s.lcpMs, LIMITS.lcp, 'ms', 'Il contenuto principale appare tardi: impatto diretto su conversione e SEO.',
    'Ottimizzare immagine hero (formato, dimensioni, preload), ridurre CSS/JS bloccanti, verificare il tempo di risposta del server e la cache.');
  metric('FE-002', 'CLS', s.cls, LIMITS.cls, '', 'La pagina si sposta durante il caricamento: clic sbagliati e cattiva esperienza.',
    'Riservare lo spazio a immagini, banner e slot (width/height, aspect-ratio).');
  metric('FE-003', 'INP', s.inpMs, LIMITS.inp, 'ms', 'La pagina risponde lentamente ai clic.',
    'Ridurre il JavaScript eseguito sul thread principale e i listener pesanti.');
  if (s.source === 'lab') {
    metric('FE-004', 'Total Blocking Time', s.tbtMs, LIMITS.tbt, 'ms', 'Thread principale bloccato: la pagina non risponde durante il caricamento.',
      'Dividere i bundle, rimandare gli script non critici, ridurre le terze parti.');
  }
  if (s.jsBytes && s.jsBytes > LIMITS.jsBytes) {
    out.push({rule: 'FE-005', category: 'frontend', severity: 'medium', title: `JavaScript pesante: ${fmt(s.jsBytes, 'B')}`,
      evidence: [{ref, data: {jsBytes: s.jsBytes, limit: LIMITS.jsBytes}}],
      impact: 'Più download e più tempo di esecuzione, soprattutto su mobile.',
      fix: 'Rimuovere codice non usato, caricare i moduli solo nelle pagine che servono.'});
  } else if (s.totalBytes && s.totalBytes > LIMITS.totalBytes) {
    out.push({rule: 'FE-005', category: 'frontend', severity: 'low', title: `Pagina pesante: ${fmt(s.totalBytes, 'B')}`,
      evidence: [{ref, data: {totalBytes: s.totalBytes, limit: LIMITS.totalBytes}}],
      impact: 'Caricamento lento su reti mobili.', fix: 'Comprimere immagini e ridurre le risorse caricate.'});
  }
  if (s.thirdPartyBlockingMs && s.thirdPartyBlockingMs > LIMITS.thirdPartyBlockingMs) {
    out.push({rule: 'FE-006', category: 'frontend', severity: 'medium',
      title: `Terze parti bloccano il thread principale per ${s.thirdPartyBlockingMs} ms`,
      evidence: [{ref, data: {topThirdParties: s.topThirdParties}}],
      impact: 'Tag di marketing e widget rallentano la pagina.',
      fix: 'Caricare le terze parti in modo differito o dopo il consenso; rimuovere quelle non usate.'});
  }
  if (s.consoleErrors.length) {
    out.push({rule: 'FE-007', category: 'frontend', severity: 'medium', title: `Errori nella console del browser (${s.consoleErrors.length})`,
      evidence: [{ref, excerpt: s.consoleErrors.join('\n')}],
      impact: 'Script che falliscono possono rompere funzioni della pagina (tracking, add to cart, widget).',
      fix: 'Correggere gli errori indicati partendo da quelli del codice della storefront.'});
  }
  return out;
}

function fmt(v: number, unit: string): string {
  if (unit === 'B') return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} MB` : `${Math.round(v / 1000)} KB`;
  if (unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
  return String(Math.round(v * 1000) / 1000);
}
