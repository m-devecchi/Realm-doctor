import {describe, expect, it} from 'vitest';
import {aggregateQuota, parseQuotaEvent, quotaFindings, type QuotaEvent} from '../src/lib/quota.js';
import {loadLogs} from './helpers.js';

describe('quota', () => {
  const events = loadLogs('quota-').map(parseQuotaEvent).filter((e): e is QuotaEvent => !!e);

  it('parses every quota line', () => {
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({
      quota: 'api.jsArraySize',
      enforced: true,
      warn: 15000,
      limit: 20000,
      kind: 'limit',
      times: 3,
      maxActual: 21000,
      location: 'request/site Sites-RefArch-Site/top pipeline Search-Show',
    });
    expect(events[1].enforced).toBe(false);
    expect(events[4].quota).toBe('object.ProductPO.readonly@SF');
  });

  it('aggregates per quota and computes the ratio to the limit', () => {
    const s = aggregateQuota(events);
    const str = s.find((q) => q.quota === 'api.jsStringLength')!;
    expect(str.warnExceeded).toBe(3);
    expect(str.maxActual).toBe(850000);
    expect(str.limitRatio).toBe(0.85);
    expect(s[0].quota).toBe('api.jsArraySize');
  });

  it('maps severities: enforced limit = critical, not enforced = high, warn near limit = high', () => {
    const f = quotaFindings(aggregateQuota(events));
    const by = Object.fromEntries(f.map((x) => [x.evidence[0].ref, x]));
    expect(by['quota:api.jsArraySize']).toMatchObject({rule: 'QUOTA-001', severity: 'critical'});
    expect(by['quota:api.dw.catalog.ProductMgr.getProduct']).toMatchObject({rule: 'QUOTA-002', severity: 'high'});
    expect(by['quota:api.jsStringLength']).toMatchObject({rule: 'QUOTA-003', severity: 'high'});
    expect(by['quota:object.ProductPO.readonly@SF']).toMatchObject({rule: 'QUOTA-003', severity: 'medium'});
  });

  it('ignores non-quota messages', () => {
    expect(parseQuotaEvent({file: 'f', message: 'Something else', details: []})).toBeUndefined();
  });
});
