import {type Finding, type Severity} from '../lib/finding.js';

/**
 * Data read through the OCAPI Data API (shapes follow the OCAPI documents:
 * promotion, campaign, promotion_campaign_assignment, coupon, customer_group).
 * Only the fields used by the rules are typed.
 */
export interface PromoSchedule {
  start_date?: string;
  end_date?: string;
}
export interface Promotion {
  id?: string;
  enabled?: boolean;
  exclusivity?: 'no' | 'class' | 'global';
  promotion_class?: 'product' | 'shipping' | 'order';
  currency_code?: string;
  archived?: boolean;
  name?: Record<string, string>;
}
export interface Campaign {
  campaign_id?: string;
  enabled?: boolean;
  start_date?: string;
  end_date?: string;
  coupons?: string[];
  customer_groups?: string[];
  source_code_groups?: string[];
}
export interface Assignment {
  promotion_id?: string;
  campaign_id?: string;
  enabled?: boolean;
  rank?: number;
  schedule?: PromoSchedule;
  coupons?: string[];
  customer_groups?: string[];
  source_code_groups?: string[];
  coupons_based?: boolean;
  customer_groups_based?: boolean;
  source_code_based?: boolean;
}
export interface Coupon {
  coupon_id?: string;
  enabled?: boolean;
  type?: 'single_code' | 'multiple_codes' | 'system_codes';
  single_code?: string;
  total_codes_count?: number;
  redemption_count?: number;
  exported_code_count?: number;
}
export interface CustomerGroup {
  id?: string;
  type?: 'system' | 'dynamic' | 'static';
  member_count?: number;
}

export interface PromoBundle {
  site: string;
  /** reference time, ISO. Default: now */
  now?: string;
  /** site currencies, used for the currency check */
  currencies?: string[];
  promotions: Promotion[];
  campaigns: Campaign[];
  assignments: Assignment[];
  coupons: Coupon[];
  customerGroups: CustomerGroup[];
}

type Window = {start: number; end: number};

const FAR_PAST = -8.64e15;
const FAR_FUTURE = 8.64e15;

function toWindow(start?: string, end?: string): Window {
  return {start: start ? Date.parse(start) : FAR_PAST, end: end ? Date.parse(end) : FAR_FUTURE};
}

function intersect(a: Window, b: Window): Window | undefined {
  const w = {start: Math.max(a.start, b.start), end: Math.min(a.end, b.end)};
  return w.start < w.end ? w : undefined;
}

function fmt(w: Window): string {
  const d = (n: number) => (n === FAR_PAST || n === FAR_FUTURE ? '∞' : new Date(n).toISOString().slice(0, 16).replace('T', ' '));
  return `${d(w.start)} → ${d(w.end)}`;
}

interface EffectiveAssignment {
  a: Assignment;
  promo?: Promotion;
  campaign?: Campaign;
  /** time window where the assignment can fire (campaign ∩ assignment schedule) */
  window?: Window;
  /** enabled at every level */
  enabled: boolean;
}

export function analyzePromotions(bundle: PromoBundle): Finding[] {
  const now = bundle.now ? Date.parse(bundle.now) : Date.now();
  const promos = new Map(bundle.promotions.filter((p) => p.id).map((p) => [p.id!, p]));
  const campaigns = new Map(bundle.campaigns.filter((c) => c.campaign_id).map((c) => [c.campaign_id!, c]));
  const coupons = new Map(bundle.coupons.filter((c) => c.coupon_id).map((c) => [c.coupon_id!, c]));
  const groups = new Map(bundle.customerGroups.filter((g) => g.id).map((g) => [g.id!, g]));
  const findings: Finding[] = [];
  const push = (rule: string, severity: Severity, title: string, ref: string, data: Record<string, unknown>, impact: string, fix: string) =>
    findings.push({rule, category: 'promotions', severity, title, evidence: [{ref, data}], impact, fix});

  const effective: EffectiveAssignment[] = bundle.assignments.map((a) => {
    const promo = a.promotion_id ? promos.get(a.promotion_id) : undefined;
    const campaign = a.campaign_id ? campaigns.get(a.campaign_id) : undefined;
    const cw = toWindow(campaign?.start_date, campaign?.end_date);
    const aw = toWindow(a.schedule?.start_date, a.schedule?.end_date);
    return {
      a,
      promo,
      campaign,
      window: intersect(cw, aw),
      enabled: a.enabled !== false && campaign?.enabled !== false && promo?.enabled !== false && promo?.archived !== true,
    };
  });

  const isLive = (e: EffectiveAssignment) => e.enabled && !!e.window && e.window.start <= now && now < e.window.end;
  const isLiveOrUpcoming = (e: EffectiveAssignment) => e.enabled && !!e.window && now < e.window.end;

  // PROMO-001 enabled promotion that can never fire (no live or upcoming assignment)
  for (const p of bundle.promotions) {
    if (!p.id || p.enabled === false || p.archived) continue;
    const mine = effective.filter((e) => e.a.promotion_id === p.id);
    if (mine.some(isLiveOrUpcoming)) continue;
    const reasons = mine.length === 0
      ? ['not assigned to any campaign']
      : mine.map((e) => describeDead(e, now));
    push(
      'PROMO-001',
      'medium',
      `Enabled promotion that can never fire: ${p.id}`,
      `promotion:${p.id}`,
      {reasons},
      'The business considers it live, but no customer will get it.',
      'Assign it to an active campaign with correct dates, or disable/archive it to avoid confusion.',
    );
  }

  for (const e of effective) {
    const pid = e.a.promotion_id ?? '?';
    const cid = e.a.campaign_id ?? '?';
    const ref = `assignment:${pid}@${cid}`;

    // PROMO-002 assignment to a missing campaign or promotion
    if (!e.campaign || !e.promo) {
      push('PROMO-002', 'high', `Orphan assignment: ${pid} @ ${cid}`, ref,
        {campaignFound: !!e.campaign, promotionFound: !!e.promo},
        'Inconsistent configuration: the promotion does not behave as expected.',
        'Recreate or remove the assignment in Business Manager > Online Marketing > Campaigns.');
      continue;
    }

    // PROMO-003 schedule of the assignment outside the campaign dates
    const cw = toWindow(e.campaign.start_date, e.campaign.end_date);
    const aw = toWindow(e.a.schedule?.start_date, e.a.schedule?.end_date);
    if ((e.a.schedule?.start_date || e.a.schedule?.end_date) && (!e.window || aw.start < cw.start || aw.end > cw.end)) {
      push('PROMO-003', e.window ? 'medium' : 'high',
        `Promotion dates outside the campaign: ${pid} @ ${cid}`, ref,
        {campaign: fmt(cw), promotionSchedule: fmt(aw), effective: e.window ? fmt(e.window) : 'no overlap'},
        e.window ? 'The promotion only applies in the date range shared with the campaign.' : 'The promotion can never fire: the dates do not overlap.',
        'Align the promotion and campaign dates.');
    }

    if (!isLiveOrUpcoming(e)) continue;

    // PROMO-004 customer groups that do not exist or are empty
    const groupIds = [...(e.campaign.customer_groups ?? []), ...(e.a.customer_groups ?? [])];
    for (const gid of new Set(groupIds)) {
      const g = groups.get(gid);
      if (!g) {
        push('PROMO-004', 'high', `Customer group does not exist: ${gid} (${pid} @ ${cid})`, ref, {customerGroup: gid},
          'No customer belongs to the group: the promotion does not fire.',
          'Fix the customer group in the campaign or the promotion.');
      } else if (g.type === 'static' && (g.member_count ?? 0) === 0) {
        push('PROMO-004', 'high', `Empty static customer group: ${gid} (${pid} @ ${cid})`, ref, {customerGroup: gid, members: 0},
          'The group has no members: the promotion fires for nobody.',
          'Import the group members or use a dynamic group.');
      }
    }

    // PROMO-005 coupons: missing, disabled, exhausted; coupon-based without coupons
    const couponIds = [...(e.campaign.coupons ?? []), ...(e.a.coupons ?? [])];
    if (e.a.coupons_based && couponIds.length === 0) {
      push('PROMO-005', 'high', `Coupon-based promotion without coupons: ${pid} @ ${cid}`, ref, {},
        'The qualifier requires a coupon but none is linked: the promotion does not fire.',
        'Link the coupon to the campaign or the promotion, or remove the coupon qualifier.');
    }
    for (const id of new Set(couponIds)) {
      const c = coupons.get(id);
      if (!c) {
        push('PROMO-005', 'high', `Coupon does not exist: ${id} (${pid} @ ${cid})`, ref, {coupon: id},
          'The linked coupon does not exist: no code can activate the promotion.', 'Fix the coupon reference.');
      } else if (c.enabled === false) {
        push('PROMO-005', 'high', `Coupon disabled: ${id} (${pid} @ ${cid})`, ref, {coupon: id},
          'Customers enter the code but it is rejected.', 'Enable the coupon or stop communicating the code.');
      } else if (c.type === 'single_code' && !c.single_code) {
        push('PROMO-005', 'high', `Single-code coupon without a code: ${id}`, ref, {coupon: id},
          'There is no code to enter.', 'Set the coupon code.');
      } else if (c.type === 'multiple_codes' && (c.total_codes_count ?? 0) === 0) {
        push('PROMO-005', 'high', `Multi-code coupon with no codes loaded: ${id}`, ref, {coupon: id},
          'No valid code: the promotion cannot fire.', 'Import the coupon codes.');
      } else if (c.type === 'multiple_codes' && c.total_codes_count && c.redemption_count !== undefined && c.redemption_count >= c.total_codes_count) {
        push('PROMO-005', 'medium', `Coupon exhausted: ${id}`, ref, {coupon: id, total: c.total_codes_count, redeemed: c.redemption_count},
          'All codes have already been redeemed.', 'Load new codes or close the campaign.');
      }
    }

    // PROMO-006 currency different from the site currencies
    if (e.promo.currency_code && bundle.currencies?.length && !bundle.currencies.includes(e.promo.currency_code)) {
      push('PROMO-006', 'high', `Promotion currency not used by the site: ${pid} (${e.promo.currency_code})`, ref,
        {promotionCurrency: e.promo.currency_code, siteCurrencies: bundle.currencies},
        'Thresholds and amount discounts only apply to baskets in that currency: the promotion does not fire.',
        'Set the correct currency, or leave it empty for percentage promotions.');
    }
  }

  // PROMO-007 global exclusivity overlapping other live promotions
  const live = effective.filter(isLive);
  for (const e of live) {
    if (e.promo?.exclusivity !== 'global') continue;
    const others = live.filter((o) => o.promo?.id !== e.promo?.id);
    if (others.length === 0) continue;
    push('PROMO-007', 'high', `Globally exclusive promotion live alongside others: ${e.promo.id}`,
      `promotion:${e.promo.id}`,
      {otherLivePromotions: [...new Set(others.map((o) => o.promo?.id))].slice(0, 20)},
      'When it qualifies, it blocks every other promotion in the basket, including those the business expects to stack.',
      'Check whether global exclusivity is intended; otherwise use "class" or "no" and set the rank.');
  }

  // PROMO-008 same rank, same class, overlapping, exclusive at class level -> ambiguous winner
  const byClass = new Map<string, EffectiveAssignment[]>();
  for (const e of live) {
    const cls = e.promo?.promotion_class ?? 'unknown';
    byClass.set(cls, [...(byClass.get(cls) ?? []), e]);
  }
  for (const [cls, list] of byClass) {
    const exclusive = list.filter((e) => e.promo?.exclusivity === 'class' || e.promo?.exclusivity === 'global');
    const noRank = exclusive.filter((e) => e.a.rank === undefined || e.a.rank === null);
    if (exclusive.length > 1 && noRank.length > 0) {
      push('PROMO-008', 'medium', `Exclusive ${cls} promotions without rank`, `class:${cls}`,
        {promotions: noRank.map((e) => e.promo?.id)},
        'With several exclusive promotions without rank, the winner depends on the platform\'s internal order: hard to predict.',
        'Set an explicit rank on every exclusive promotion.');
    }
    const ranks = new Map<number, string[]>();
    for (const e of exclusive) {
      if (typeof e.a.rank !== 'number') continue;
      ranks.set(e.a.rank, [...(ranks.get(e.a.rank) ?? []), e.promo?.id ?? '?']);
    }
    for (const [rank, ids] of ranks) {
      const unique = [...new Set(ids)];
      if (unique.length > 1) {
        push('PROMO-008', 'medium', `Duplicate rank (${rank}) among exclusive ${cls} promotions`, `class:${cls}`,
          {rank, promotions: unique},
          'With equal ranks the applied promotion may not be the one the business expects.',
          'Use distinct ranks following the intended priority.');
      }
    }
  }

  // PROMO-009 same promotion in several live campaigns
  const livePerPromo = new Map<string, Set<string>>();
  for (const e of live) {
    const id = e.promo?.id;
    if (!id) continue;
    livePerPromo.set(id, (livePerPromo.get(id) ?? new Set()).add(e.campaign?.campaign_id ?? '?'));
  }
  for (const [id, set] of livePerPromo) {
    if (set.size > 1) {
      push('PROMO-009', 'low', `Promotion live in several campaigns at the same time: ${id}`, `promotion:${id}`,
        {campaigns: [...set]},
        'Different qualifiers per campaign can extend the promotion to unintended customers.',
        'Check that every assignment is intended; keep a single campaign when possible.');
    }
  }

  return findings;
}

function describeDead(e: EffectiveAssignment, now: number): string {
  const where = `${e.a.campaign_id ?? '?'}`;
  if (!e.campaign) return `${where}: campaign does not exist`;
  if (e.campaign.enabled === false) return `${where}: campaign disabled`;
  if (e.a.enabled === false) return `${where}: assignment disabled`;
  if (!e.window) return `${where}: promotion and campaign dates do not overlap`;
  if (e.window.end <= now) return `${where}: expired on ${new Date(e.window.end).toISOString().slice(0, 10)}`;
  return `${where}: not active`;
}
