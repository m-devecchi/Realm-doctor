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
      ? ['non assegnata a nessuna campagna']
      : mine.map((e) => describeDead(e, now));
    push(
      'PROMO-001',
      'medium',
      `Promo abilitata che non può scattare: ${p.id}`,
      `promotion:${p.id}`,
      {reasons},
      'Il business la considera attiva, ma nessun cliente la riceverà.',
      'Assegnarla a una campagna attiva con date corrette, o disabilitarla/archiviarla per evitare confusione.',
    );
  }

  for (const e of effective) {
    const pid = e.a.promotion_id ?? '?';
    const cid = e.a.campaign_id ?? '?';
    const ref = `assignment:${pid}@${cid}`;

    // PROMO-002 assignment to a missing campaign or promotion
    if (!e.campaign || !e.promo) {
      push('PROMO-002', 'high', `Assegnazione orfana: ${pid} @ ${cid}`, ref,
        {campaignFound: !!e.campaign, promotionFound: !!e.promo},
        'Configurazione incoerente: la promo non si comporta come previsto.',
        'Ricreare o rimuovere l\'assegnazione in Business Manager > Online Marketing > Campaigns.');
      continue;
    }

    // PROMO-003 schedule of the assignment outside the campaign dates
    const cw = toWindow(e.campaign.start_date, e.campaign.end_date);
    const aw = toWindow(e.a.schedule?.start_date, e.a.schedule?.end_date);
    if ((e.a.schedule?.start_date || e.a.schedule?.end_date) && (!e.window || aw.start < cw.start || aw.end > cw.end)) {
      push('PROMO-003', e.window ? 'medium' : 'high',
        `Date della promo fuori dalla campagna: ${pid} @ ${cid}`, ref,
        {campaign: fmt(cw), promotionSchedule: fmt(aw), effective: e.window ? fmt(e.window) : 'nessuna sovrapposizione'},
        e.window ? 'La promo vale solo nella parte di date in comune con la campagna.' : 'La promo non può mai scattare: le date non si sovrappongono.',
        'Allineare le date della promo e della campagna.');
    }

    if (!isLiveOrUpcoming(e)) continue;

    // PROMO-004 customer groups that do not exist or are empty
    const groupIds = [...(e.campaign.customer_groups ?? []), ...(e.a.customer_groups ?? [])];
    for (const gid of new Set(groupIds)) {
      const g = groups.get(gid);
      if (!g) {
        push('PROMO-004', 'high', `Customer group inesistente: ${gid} (${pid} @ ${cid})`, ref, {customerGroup: gid},
          'Nessun cliente appartiene al gruppo: la promo non scatta.',
          'Correggere il customer group nella campagna o nella promo.');
      } else if (g.type === 'static' && (g.member_count ?? 0) === 0) {
        push('PROMO-004', 'high', `Customer group statico vuoto: ${gid} (${pid} @ ${cid})`, ref, {customerGroup: gid, members: 0},
          'Il gruppo non ha membri: la promo non scatta per nessuno.',
          'Importare i membri del gruppo o usare un gruppo dinamico.');
      }
    }

    // PROMO-005 coupons: missing, disabled, exhausted; coupon-based without coupons
    const couponIds = [...(e.campaign.coupons ?? []), ...(e.a.coupons ?? [])];
    if (e.a.coupons_based && couponIds.length === 0) {
      push('PROMO-005', 'high', `Promo basata su coupon senza coupon: ${pid} @ ${cid}`, ref, {},
        'Il qualificatore richiede un coupon ma nessun coupon è collegato: la promo non scatta.',
        'Collegare il coupon alla campagna o alla promo, oppure togliere il qualificatore coupon.');
    }
    for (const id of new Set(couponIds)) {
      const c = coupons.get(id);
      if (!c) {
        push('PROMO-005', 'high', `Coupon inesistente: ${id} (${pid} @ ${cid})`, ref, {coupon: id},
          'Il coupon collegato non esiste: nessun codice può attivare la promo.', 'Correggere il riferimento al coupon.');
      } else if (c.enabled === false) {
        push('PROMO-005', 'high', `Coupon disabilitato: ${id} (${pid} @ ${cid})`, ref, {coupon: id},
          'I clienti inseriscono il codice ma viene rifiutato.', 'Abilitare il coupon o fermare la comunicazione del codice.');
      } else if (c.type === 'single_code' && !c.single_code) {
        push('PROMO-005', 'high', `Coupon single code senza codice: ${id}`, ref, {coupon: id},
          'Non esiste un codice da inserire.', 'Impostare il codice del coupon.');
      } else if (c.type === 'multiple_codes' && (c.total_codes_count ?? 0) === 0) {
        push('PROMO-005', 'high', `Coupon multi-codice senza codici caricati: ${id}`, ref, {coupon: id},
          'Nessun codice valido: la promo non può scattare.', 'Importare i codici del coupon.');
      } else if (c.type === 'multiple_codes' && c.total_codes_count && c.redemption_count !== undefined && c.redemption_count >= c.total_codes_count) {
        push('PROMO-005', 'medium', `Coupon esaurito: ${id}`, ref, {coupon: id, total: c.total_codes_count, redeemed: c.redemption_count},
          'Tutti i codici risultano già usati.', 'Caricare nuovi codici o chiudere la campagna.');
      }
    }

    // PROMO-006 currency different from the site currencies
    if (e.promo.currency_code && bundle.currencies?.length && !bundle.currencies.includes(e.promo.currency_code)) {
      push('PROMO-006', 'high', `Valuta della promo non usata dal sito: ${pid} (${e.promo.currency_code})`, ref,
        {promotionCurrency: e.promo.currency_code, siteCurrencies: bundle.currencies},
        'Soglie e sconti a importo valgono solo per i carrelli in quella valuta: la promo non scatta.',
        'Impostare la valuta corretta o lasciarla vuota per le promo a percentuale.');
    }
  }

  // PROMO-007 global exclusivity overlapping other live promotions
  const live = effective.filter(isLive);
  for (const e of live) {
    if (e.promo?.exclusivity !== 'global') continue;
    const others = live.filter((o) => o.promo?.id !== e.promo?.id);
    if (others.length === 0) continue;
    push('PROMO-007', 'high', `Promo con esclusività globale attiva insieme ad altre: ${e.promo.id}`,
      `promotion:${e.promo.id}`,
      {otherLivePromotions: [...new Set(others.map((o) => o.promo?.id))].slice(0, 20)},
      'Se si qualifica, blocca tutte le altre promo nel carrello, anche quelle che il business pensa si sommino.',
      'Verificare se l\'esclusività globale è voluta; altrimenti usare "class" o "no" e definire il rank.');
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
      push('PROMO-008', 'medium', `Promo esclusive di classe ${cls} senza rank`, `class:${cls}`,
        {promotions: noRank.map((e) => e.promo?.id)},
        'Con più promo esclusive senza rank, quale vince dipende dall\'ordine interno della piattaforma: risultato poco prevedibile.',
        'Assegnare un rank esplicito a ogni promo esclusiva.');
    }
    const ranks = new Map<number, string[]>();
    for (const e of exclusive) {
      if (typeof e.a.rank !== 'number') continue;
      ranks.set(e.a.rank, [...(ranks.get(e.a.rank) ?? []), e.promo?.id ?? '?']);
    }
    for (const [rank, ids] of ranks) {
      const unique = [...new Set(ids)];
      if (unique.length > 1) {
        push('PROMO-008', 'medium', `Rank duplicato (${rank}) tra promo esclusive di classe ${cls}`, `class:${cls}`,
          {rank, promotions: unique},
          'A parità di rank la promo applicata non è quella che il business si aspetta.',
          'Differenziare i rank secondo la priorità desiderata.');
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
      push('PROMO-009', 'low', `Promo attiva in più campagne contemporaneamente: ${id}`, `promotion:${id}`,
        {campaigns: [...set]},
        'Qualificatori diversi per campagna possono estendere la promo a clienti non previsti.',
        'Verificare che ogni assegnazione sia voluta; tenere una sola campagna se possibile.');
    }
  }

  return findings;
}

function describeDead(e: EffectiveAssignment, now: number): string {
  const where = `${e.a.campaign_id ?? '?'}`;
  if (!e.campaign) return `${where}: campagna inesistente`;
  if (e.campaign.enabled === false) return `${where}: campagna disabilitata`;
  if (e.a.enabled === false) return `${where}: assegnazione disabilitata`;
  if (!e.window) return `${where}: date promo e campagna non si sovrappongono`;
  if (e.window.end <= now) return `${where}: scaduta il ${new Date(e.window.end).toISOString().slice(0, 10)}`;
  return `${where}: non attiva`;
}
