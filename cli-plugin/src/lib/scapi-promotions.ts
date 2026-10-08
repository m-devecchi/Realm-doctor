/**
 * Promotions, campaigns, assignments, coupons and customer groups through the SCAPI Admin APIs
 * (Promotions, Campaigns, Coupons, Customers). Read-only: searches (POST on the collection, the
 * documented search operation), and GETs. Results are mapped to the OCAPI-shaped PromoBundle used
 * by the rules, so both backends produce the same analysis.
 *
 * Endpoints and fields follow the official OpenAPI specs shipped with @salesforce/b2c-api-schemas.
 */
import {buildScapiClient, createScapiRequestError, toOrganizationId} from '@salesforce/b2c-tooling-sdk/clients';
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk';
import type {Assignment, Campaign, Coupon, CustomerGroup, PromoBundle, Promotion} from '../rules/promo-rules.js';

type ScapiConfig = NonNullable<B2CInstance['scapiClientConfig']>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const SCAPI_PROMOTION_SCOPES = ['sfcc.promotions'];
export const SCAPI_CUSTOMER_GROUP_SCOPES = ['sfcc.customergroups'];

/* SCAPI shapes (camelCase), only the fields used */
interface ScapiPromotion {
  id?: string;
  enabled?: boolean;
  exclusivity?: Promotion['exclusivity'];
  promotionClass?: Promotion['promotion_class'];
  currencyCode?: string;
  archived?: boolean;
  name?: Record<string, string>;
}
interface ScapiCampaign {
  campaignId?: string;
  enabled?: boolean;
  startDate?: string;
  endDate?: string;
  coupons?: string[];
  customerGroups?: string[];
  sourceCodeGroups?: string[];
}
interface ScapiAssignment {
  promotionId?: string;
  campaignId?: string;
  enabled?: boolean;
  rank?: number;
  schedule?: {startDate?: string; endDate?: string};
  coupons?: string[];
  customerGroups?: string[];
  sourceCodeGroups?: string[];
  couponsBased?: boolean;
  customerGroupsBased?: boolean;
  sourceCodeBased?: boolean;
}
interface ScapiCoupon {
  couponId?: string;
  enabled?: boolean;
  type?: Coupon['type'];
  singleCode?: string;
  totalCodesCount?: number;
  redemptionCount?: number;
  exportedCodeCount?: number;
}
interface ScapiCustomerGroup {
  id?: string;
  type?: CustomerGroup['type'];
  memberCount?: number;
}

export const mapPromotion = (p: ScapiPromotion): Promotion => ({
  id: p.id,
  enabled: p.enabled,
  exclusivity: p.exclusivity,
  promotion_class: p.promotionClass,
  currency_code: p.currencyCode,
  archived: p.archived,
  name: p.name,
});

export const mapCampaign = (c: ScapiCampaign): Campaign => ({
  campaign_id: c.campaignId,
  enabled: c.enabled,
  start_date: c.startDate,
  end_date: c.endDate,
  coupons: c.coupons,
  customer_groups: c.customerGroups,
  source_code_groups: c.sourceCodeGroups,
});

/** The "…Based" flags default to true when the matching list is non-empty (per the spec). */
export const mapAssignment = (a: ScapiAssignment): Assignment => ({
  promotion_id: a.promotionId,
  campaign_id: a.campaignId,
  enabled: a.enabled,
  rank: a.rank,
  schedule: a.schedule ? {start_date: a.schedule.startDate, end_date: a.schedule.endDate} : undefined,
  coupons: a.coupons,
  customer_groups: a.customerGroups,
  source_code_groups: a.sourceCodeGroups,
  coupons_based: a.couponsBased ?? (a.coupons?.length ?? 0) > 0,
  customer_groups_based: a.customerGroupsBased ?? (a.customerGroups?.length ?? 0) > 0,
  source_code_based: a.sourceCodeBased ?? (a.sourceCodeGroups?.length ?? 0) > 0,
});

export const mapCoupon = (c: ScapiCoupon): Coupon => ({
  coupon_id: c.couponId,
  enabled: c.enabled,
  type: c.type,
  single_code: c.singleCode,
  total_codes_count: c.totalCodesCount,
  redemption_count: c.redemptionCount,
  exported_code_count: c.exportedCodeCount,
});

export const mapCustomerGroup = (g: ScapiCustomerGroup): CustomerGroup => ({id: g.id, type: g.type, member_count: g.memberCount});

const PAGE = 200;

function client(scapi: ScapiConfig, pathSegment: string, scopes: string[], logPrefix: string): AnyClient {
  return buildScapiClient<AnyClient>({pathSegment, domainKey: 'scapi', defaultScopes: scopes, logPrefix}, {shortCode: scapi.shortCode, tenantId: scapi.tenantId}, scapi.auth);
}

/** Pages through a SCAPI search (POST on the collection) with matchAllQuery. */
async function searchAll<T>(c: AnyClient, path: string, organizationId: string, siteId: string, maxRecords = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; ) {
    const {data, error, response} = await c.POST(path, {
      params: {path: {organizationId}, query: {siteId}},
      body: {query: {matchAllQuery: {}}, limit: PAGE, offset},
    });
    if (error || !data) throw createScapiRequestError(error, response, `SCAPI POST ${path} failed: ${response.status}`);
    const hits = (data.hits ?? []) as T[];
    out.push(...hits);
    offset += hits.length;
    if (hits.length === 0 || offset >= Number(data.total ?? 0) || offset >= maxRecords) return out;
  }
}

/** Pages through a SCAPI list (GET with limit/offset). */
async function listAll<T>(c: AnyClient, path: string, organizationId: string, siteId: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; ) {
    const {data, error, response} = await c.GET(path, {params: {path: {organizationId}, query: {siteId, limit: PAGE, offset}}});
    if (error || !data) throw createScapiRequestError(error, response, `SCAPI GET ${path} failed: ${response.status}`);
    const rows = (data.data ?? []) as T[];
    out.push(...rows);
    offset += rows.length;
    if (rows.length === 0 || offset >= Number(data.total ?? 0)) return out;
  }
}

async function mapLimit<I, O>(items: I[], limit: number, fn: (i: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({length: Math.min(limit, items.length)}, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function fetchPromoBundleScapi(scapi: ScapiConfig, siteId: string, currencies?: string[]): Promise<PromoBundle> {
  const org = toOrganizationId(scapi.tenantId);
  const promotionsApi = client(scapi, 'pricing/promotions/v1', SCAPI_PROMOTION_SCOPES, 'SCAPI-PROMOTIONS');
  const campaignsApi = client(scapi, 'pricing/campaigns/v1', SCAPI_PROMOTION_SCOPES, 'SCAPI-CAMPAIGNS');
  const couponsApi = client(scapi, 'pricing/coupons/v1', SCAPI_PROMOTION_SCOPES, 'SCAPI-COUPONS');
  const customersApi = client(scapi, 'customer/customers/v1', SCAPI_CUSTOMER_GROUP_SCOPES, 'SCAPI-CUSTOMERS');

  const [promotions, campaigns, coupons, customerGroups] = await Promise.all([
    searchAll<ScapiPromotion>(promotionsApi, '/organizations/{organizationId}/promotions', org, siteId),
    searchAll<ScapiCampaign>(campaignsApi, '/organizations/{organizationId}/campaigns', org, siteId),
    searchAll<ScapiCoupon>(couponsApi, '/organizations/{organizationId}/coupons', org, siteId),
    listAll<ScapiCustomerGroup>(customersApi, '/organizations/{organizationId}/customer-groups', org, siteId),
  ]);

  // assignments are listed per campaign
  const perCampaign = await mapLimit(campaigns.filter((c) => c.campaignId), 8, async (c) => {
    const {data, error, response} = await campaignsApi.GET('/organizations/{organizationId}/campaigns/{campaignId}/promotions', {
      params: {path: {organizationId: org, campaignId: c.campaignId}, query: {siteId}},
    });
    if (error || !data) throw createScapiRequestError(error, response, `SCAPI GET campaign ${c.campaignId} promotions failed: ${response.status}`);
    return ((data.data ?? []) as ScapiAssignment[]).map((a) => mapAssignment({...a, campaignId: a.campaignId ?? c.campaignId}));
  });

  return {
    site: siteId,
    now: new Date().toISOString(),
    currencies,
    promotions: promotions.map(mapPromotion),
    campaigns: campaigns.map(mapCampaign),
    assignments: perCampaign.flat(),
    coupons: coupons.map(mapCoupon),
    customerGroups: customerGroups.map(mapCustomerGroup),
  };
}
