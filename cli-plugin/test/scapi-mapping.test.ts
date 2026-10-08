/**
 * SCAPI mapping checked against the official OpenAPI specs (@salesforce/b2c-api-schemas, shipped with the SDK):
 * every field the mapper reads exists in the spec with the expected type, and SCAPI → bundle mapping gives back
 * the same data the rules use, so SCAPI and OCAPI produce the same findings.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {Validator} from 'jsonschema';
import {describe, expect, it} from 'vitest';
import {mapAssignment, mapCampaign, mapCoupon, mapCustomerGroup, mapPromotion} from '../src/lib/scapi-promotions.js';
import {analyzePromotions, type PromoBundle} from '../src/rules/promo-rules.js';
import {toScapi, toScapiAssignment} from './e2e/mock-sfcc.js';
import {FIXTURES} from './helpers.js';

const require = createRequire(import.meta.url);
const sdkDir = dirname(require.resolve('@salesforce/b2c-tooling-sdk/package.json'));
const schemasDir = join(dirname(createRequire(join(sdkDir, 'package.json')).resolve('@salesforce/b2c-api-schemas/package.json')), 'scapi');
const spec = (p: string) => JSON.parse(readFileSync(join(schemasDir, p), 'utf8'));
const bundle = JSON.parse(readFileSync(join(FIXTURES, 'promo', 'bundle.json'), 'utf8')) as PromoBundle;
const jobs = JSON.parse(readFileSync(join(FIXTURES, 'jobs', 'executions.json'), 'utf8')) as unknown[];

/** properties of a component schema, following allOf */
function propsOf(doc: any, name: string): Record<string, any> {
  const s = doc.components.schemas[name];
  const parts = [s, ...(s.allOf ?? []).map((x: any) => (x.$ref ? doc.components.schemas[x.$ref.split('/').pop()] : x))];
  return Object.assign({}, ...parts.map((p: any) => p.properties ?? {}));
}

function check(file: string, schema: string, objects: unknown[]) {
  const doc = spec(file);
  const props = propsOf(doc, schema);
  const v = new Validator();
  v.addSchema(doc, `/${file}`);
  for (const o of objects as Array<Record<string, unknown>>) {
    // every field we produce/read is in the spec
    expect(Object.keys(o).filter((k) => !(k in props)), `${schema} fields`).toEqual([]);
    const res = v.validate(o, {$ref: `/${file}#/components/schemas/${schema}`});
    // the fixtures come from OCAPI, where an assignment may have no rank; SCAPI always returns one
    const errors = res.errors.map((e) => e.stack).filter((e) => e !== 'instance requires property "rank"');
    expect(errors, `${schema} ${JSON.stringify(o).slice(0, 80)}`).toEqual([]);
  }
}

describe('SCAPI shapes match the official specs', () => {
  it('promotions, campaigns, assignments, coupons, customer groups', () => {
    check('pricing/promotions/v1.json', 'Promotion', bundle.promotions.map(toScapi));
    check('pricing/campaigns/v1.json', 'Campaign', bundle.campaigns.map(toScapi));
    check('pricing/campaigns/v1.json', 'PromotionCampaignAssignment', bundle.assignments.map(toScapiAssignment));
    check('pricing/coupons/v1.json', 'Coupon', bundle.coupons.map(toScapi));
    check('customer/customers/v1.json', 'CustomerGroup', bundle.customerGroups.map(toScapi));
  });

  it('job executions', () => {
    const doc = spec('operation/jobs/v1.json');
    const exec = propsOf(doc, 'JobExecution');
    const step = propsOf(doc, 'JobStepExecution');
    for (const j of jobs.map(toScapi) as Array<Record<string, any>>) {
      expect(Object.keys(j).filter((k) => !(k in exec))).toEqual([]);
      for (const s of j.stepExecutions ?? []) expect(Object.keys(s).filter((k) => !(k in step))).toEqual([]);
    }
  });

  it('the search endpoints used exist with POST, and the list endpoints with GET', () => {
    expect(spec('pricing/promotions/v1.json').paths['/organizations/{organizationId}/promotions'].post.operationId).toBe('promotionsSearch');
    expect(spec('pricing/campaigns/v1.json').paths['/organizations/{organizationId}/campaigns'].post.operationId).toBe('campaignsSearch');
    expect(spec('pricing/coupons/v1.json').paths['/organizations/{organizationId}/coupons'].post.operationId).toBe('couponsSearch');
    expect(spec('pricing/campaigns/v1.json').paths['/organizations/{organizationId}/campaigns/{campaignId}/promotions'].get).toBeDefined();
    expect(spec('customer/customers/v1.json').paths['/organizations/{organizationId}/customer-groups'].get).toBeDefined();
  });
});

describe('SCAPI → bundle mapping', () => {
  it('gives the same findings as the OCAPI data', () => {
    const fromScapi: PromoBundle = {
      ...bundle,
      promotions: bundle.promotions.map(toScapi).map((p) => mapPromotion(p as never)),
      campaigns: bundle.campaigns.map(toScapi).map((c) => mapCampaign(c as never)),
      assignments: bundle.assignments.map(toScapiAssignment).map((a) => mapAssignment(a as never)),
      coupons: bundle.coupons.map(toScapi).map((c) => mapCoupon(c as never)),
      customerGroups: bundle.customerGroups.map(toScapi).map((g) => mapCustomerGroup(g as never)),
    };
    const strip = (fs: ReturnType<typeof analyzePromotions>) => fs.map((f) => `${f.rule}|${f.severity}|${f.title}`).sort();
    expect(strip(analyzePromotions(fromScapi))).toEqual(strip(analyzePromotions(bundle)));
  });

  it('qualifier flags default to true when the list is not empty (per the spec)', () => {
    expect(mapAssignment({coupons: ['C1']}).coupons_based).toBe(true);
    expect(mapAssignment({coupons: []}).coupons_based).toBe(false);
    expect(mapAssignment({coupons: ['C1'], couponsBased: false}).coupons_based).toBe(false);
  });
});
