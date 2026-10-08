import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {analyzePromotions, type PromoBundle} from '../src/rules/promo-rules.js';
import {FIXTURES} from './helpers.js';

const bundle = JSON.parse(readFileSync(join(FIXTURES, 'promo', 'bundle.json'), 'utf8')) as PromoBundle;

describe('promotion rules', () => {
  const findings = analyzePromotions(bundle);
  // findings whose subject is the promotion (title or evidence ref), not just mentioned as context
  const about = (id: string) =>
    findings
      .filter((f) => f.title.includes(id) || f.evidence.some((e) => e.ref?.includes(id)))
      .map((f) => f.rule)
      .sort();

  it('PROMO-007 lists the other live promotions as context', () => {
    const ctx = findings.find((f) => f.rule === 'PROMO-007')!.evidence[0].data!.otherLivePromotions as string[];
    expect(ctx).toEqual(expect.arrayContaining(['P_OK', 'P_USD', 'P_MULTI']));
    expect(ctx).not.toContain('P_GLOBAL');
  });

  it('a correctly configured promotion produces no finding', () => {
    expect(about('P_OK')).toEqual([]);
    expect(about('P_DISABLED')).toEqual([]);
  });

  it('PROMO-001: enabled but expired or unassigned', () => {
    expect(about('P_EXPIRED')).toEqual(['PROMO-001']);
    expect(about('P_UNASSIGNED')).toEqual(['PROMO-001']);
    const expired = findings.find((f) => f.title.includes('P_EXPIRED'))!;
    expect(expired.evidence[0].data).toEqual({reasons: ['C_OLD: scaduta il 2026-09-30']});
  });

  it('PROMO-002: assignment pointing to a missing promotion', () => {
    expect(about('P_GHOST')).toEqual(['PROMO-002']);
  });

  it('PROMO-003: promotion dates outside the campaign (no overlap = high)', () => {
    expect(about('P_DATES')).toEqual(['PROMO-001', 'PROMO-003']);
    expect(findings.find((f) => f.rule === 'PROMO-003')!.severity).toBe('high');
  });

  it('PROMO-004: missing and empty static customer groups', () => {
    const titles = findings.filter((f) => f.rule === 'PROMO-004').map((f) => f.title);
    expect(titles).toHaveLength(2);
    expect(titles.join()).toContain('VIP_STATIC');
    expect(titles.join()).toContain('GHOST_GROUP');
  });

  it('PROMO-005: coupon problems (disabled, missing, no codes, exhausted, coupon-based without coupon)', () => {
    const titles = findings.filter((f) => f.rule === 'PROMO-005').map((f) => f.title);
    expect(titles).toHaveLength(5);
    for (const id of ['CPN_DISABLED', 'CPN_MISSING', 'CPN_EMPTY', 'CPN_USED', 'P_COUPON2']) expect(titles.join()).toContain(id);
    expect(titles.join()).not.toContain('CPN_OK');
  });

  it('PROMO-006: currency not used by the site', () => {
    expect(about('P_USD')).toEqual(['PROMO-006']);
  });

  it('PROMO-007: global exclusivity live with other promotions', () => {
    const f = findings.find((x) => x.rule === 'PROMO-007')!;
    expect(f.title).toContain('P_GLOBAL');
  });

  it('PROMO-008: exclusive promotions with duplicate rank and without rank', () => {
    const f = findings.filter((x) => x.rule === 'PROMO-008');
    expect(f.map((x) => x.title).join()).toContain('senza rank');
    expect(f.map((x) => x.title).join()).toContain('Rank duplicato (5)');
  });

  it('PROMO-009: same promotion live in two campaigns', () => {
    expect(about('P_MULTI')).toEqual(['PROMO-009']);
  });

  it('depends only on the reference date, not on the machine clock', () => {
    const later = analyzePromotions({...bundle, now: '2026-12-15T00:00:00Z'});
    // in December P_DATES is live, C_LIVE is over: different findings
    expect(later.some((f) => f.title.includes('P_OK') && f.rule === 'PROMO-001')).toBe(true);
  });
});
