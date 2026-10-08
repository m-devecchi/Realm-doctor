import {describe, expect, it} from 'vitest';
import {aggregateErrors, errorFindings} from '../src/lib/errors.js';
import {dateFromLogFileName, extractCodeRefs, parseLogText} from '../src/lib/logparse.js';
import {maskPII} from '../src/lib/mask.js';
import {normalizeMessage, signatureId} from '../src/lib/signature.js';
import {loadLogs} from './helpers.js';

describe('parseLogText', () => {
  it('parses timestamp, level, site, pipeline, message and stack lines', () => {
    const text = [
      'partial line from a ranged read',
      '[2026-10-08 10:12:33.123 GMT] ERROR PipelineCallServlet|1234|Sites-RefArch-Site|Cart-AddProduct|PipelineCall|abcdef123 custom.cart []  - Basket is null',
      '\tat app_custom/cartridge/controllers/Cart.js:45',
      '',
      '[2026-10-08 10:12:34.000 GMT] WARN SystemJobThread|99|||Job|xyz other - Slow query',
    ].join('\n');
    const entries = parseLogText(text, 'error-x-20261008.log');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      timestamp: '2026-10-08T10:12:33.123Z',
      level: 'ERROR',
      site: 'Sites-RefArch-Site',
      pipeline: 'Cart-AddProduct',
      message: 'Basket is null',
      details: ['\tat app_custom/cartridge/controllers/Cart.js:45'],
    });
    expect(entries[1].level).toBe('WARN');
    expect(entries[1].site).toBeUndefined();
    expect(entries[1].message).toBe('Slow query');
  });

  it('extracts cartridge code references with line numbers', () => {
    const [e] = parseLogText(
      '[2026-10-08 10:00:00.000 GMT] ERROR X|1|S|P|T|s c - boom\n\tat app_custom/cartridge/scripts/a.js:12 (f)\n\tat int_adyen/cartridge/templates/default/x.isml',
      'f',
    );
    expect(extractCodeRefs(e)).toEqual(['app_custom/cartridge/scripts/a.js:12', 'int_adyen/cartridge/templates/default/x.isml']);
  });

  it('reads the date from log file names', () => {
    expect(dateFromLogFileName('error-blade1-0-appserver-20261008.log')).toBe('2026-10-08');
    expect(dateFromLogFileName('custom-mylog-blade2-20251231.log')).toBe('2025-12-31');
    expect(dateFromLogFileName('nodate.log')).toBeUndefined();
  });
});

describe('maskPII', () => {
  it('masks emails, IPs, card numbers, tokens and secrets', () => {
    const out = maskPII(
      'user mario.rossi@example.com from 93.184.216.34 paid with 4111 1111 1111 1111 token=abc123XYZ Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N password: "hunter22"',
    );
    expect(out).not.toMatch(/mario|93\.184|4111|abc123XYZ|hunter22|eyJhbG/);
    expect(out).toContain('<EMAIL>');
    expect(out).toContain('<IP>');
    expect(out).toContain('<SECRET>');
  });

  it('masks order and customer numbers but keeps short technical numbers', () => {
    const out = maskPII('Payment failed for order 000864831, customerNo: 00012345, ordine nr. INT-2026-99812, retry 3 of 5 at line 142');
    expect(out).toBe('Payment failed for order <NUM>, customerNo: <NUM>, ordine nr. <NUM>, retry 3 of 5 at line 142');
  });
});

describe('signatures', () => {
  it('groups messages that differ only by ids and numbers', () => {
    const a = normalizeMessage('Product 12345 not found in catalog storefront-catalog-en');
    const b = normalizeMessage('Product 99999 not found in catalog storefront-catalog-en');
    const c = normalizeMessage('Basket aB12cD34eF56gH not found for "mario"');
    expect(a).toBe(b);
    expect(signatureId(a)).toBe(signatureId(b));
    expect(c).toBe('Basket <ID> not found for "<V>"');
  });
});

describe('aggregateErrors + errorFindings (fixtures: 3 days of error logs)', () => {
  const entries = loadLogs('error-');
  const signatures = aggregateErrors(entries);

  it('finds the two error signatures with daily counts', () => {
    expect(entries).toHaveLength(12 + 11 + 40 + 15);
    expect(signatures).toHaveLength(2);
    const [product, payment] = signatures;
    expect(product.total).toBe(63);
    expect(product.perDay).toEqual({'2026-10-06': 12, '2026-10-07': 11, '2026-10-08': 40});
    expect(payment.total).toBe(15);
    expect(payment.locations[0].location).toBe('Sites-RefArch-Site / CheckoutServices-PlaceOrder');
    expect(payment.codeRefs[0].ref).toBe('app_custom/cartridge/scripts/payment/adyenAuthorize.js:142');
  });

  it('never keeps personal data in templates or examples', () => {
    const text = JSON.stringify(signatures);
    expect(text).not.toMatch(/@example\.com|mario\.rossi|93\.184\.216/);
  });

  it('reports the new error (ERR-001) and the spike (ERR-002)', () => {
    const findings = errorFindings(signatures);
    const byRule = Object.fromEntries(findings.map((f) => [f.rule, f]));
    expect(Object.keys(byRule).sort()).toEqual(['ERR-001', 'ERR-002']);
    expect(byRule['ERR-001'].title).toContain('Payment authorization failed');
    expect(byRule['ERR-001'].severity).toBe('high');
    expect(byRule['ERR-002'].title).toContain('Product <N> not found');
    expect(byRule['ERR-002'].impact).toContain('40 occorrenze');
  });

  it('reports recurring errors (ERR-003) when there is no trend', () => {
    const onlyFirstDays = aggregateErrors(entries.filter((e) => e.timestamp! < '2026-10-08'));
    const findings = errorFindings(onlyFirstDays);
    expect(findings.map((f) => f.rule)).toEqual(['ERR-003']);
  });

  it('respects the since filter', () => {
    const recent = aggregateErrors(entries, {since: '2026-10-08T00:00:00Z'});
    expect(recent.reduce((a, s) => a + s.total, 0)).toBe(55);
  });
});
