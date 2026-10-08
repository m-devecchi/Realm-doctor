import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {frontendFindings, summarizePsi, type PsiResult} from '../src/lib/frontend.js';
import {FIXTURES} from './helpers.js';

const psi = JSON.parse(readFileSync(join(FIXTURES, 'psi', 'home-mobile.json'), 'utf8')) as PsiResult;

describe('frontend (PageSpeed Insights)', () => {
  const s = summarizePsi('https://www.example.com/', psi);

  it('prefers field data (CrUX) over lab data', () => {
    expect(s.source).toBe('field');
    expect(s.lcpMs).toBe(4300);
    expect(s.cls).toBe(0.15);
    expect(s.inpMs).toBe(180);
    expect(s.jsBytes).toBe(1_350_000);
    expect(s.performanceScore).toBe(41);
    expect(s.topThirdParties[0]).toEqual({entity: 'Google Tag Manager', blockingMs: 210, transferBytes: 120000});
    expect(s.thirdPartyBlockingMs).toBe(380);
  });

  it('produces findings with severities from Core Web Vitals thresholds', () => {
    const f = frontendFindings(s);
    const by = Object.fromEntries(f.map((x) => [x.rule, x.severity]));
    expect(by).toEqual({'FE-001': 'high', 'FE-002': 'medium', 'FE-005': 'medium', 'FE-006': 'medium', 'FE-007': 'medium'});
  });

  it('falls back to lab data and checks TBT when there is no field data', () => {
    const lab = summarizePsi('u', {lighthouseResult: psi.lighthouseResult});
    expect(lab.source).toBe('lab');
    expect(lab.lcpMs).toBe(5200);
    expect(frontendFindings(lab).map((x) => x.rule)).toContain('FE-004');
  });
});
