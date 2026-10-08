import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {analyzeCode, analyzeHyperforceReadiness} from '../src/rules/index.js';
import {loadLocalSources} from '../src/rules/source.js';
import {FIXTURES, rules} from './helpers.js';

const root = join(FIXTURES, 'cartridges');

describe('code rules on fixture cartridges', async () => {
  const files = await loadLocalSources(root);
  const findings = analyzeCode(files);
  const inFile = (name: string) => findings.filter((f) => f.evidence[0].location?.includes(name));

  it('loads only analyzable files with cartridge-relative paths', () => {
    expect(files.map((f) => f.path).sort()).toEqual([
      'app_clean/cartridge/scripts/storeExport.js',
      'app_custom/cartridge/controllers/Account.js',
      'app_custom/cartridge/scripts/config.js',
      'app_custom/cartridge/scripts/helpers/productHelper.js',
      'app_custom/cartridge/templates/default/product/tile.isml',
    ]);
  });

  it('finds every planted issue in productHelper.js', () => {
    expect(rules(inFile('productHelper.js'))).toEqual(['JS-001', 'JS-001', 'JS-002', 'JS-003', 'JS-005', 'JS-006', 'JS-009']);
    const loop = inFile('productHelper.js').find((f) => f.rule === 'JS-001' && f.title.includes('ProductMgr.getProduct'))!;
    expect(loop.evidence[0].location).toBe('app_custom/cartridge/scripts/helpers/productHelper.js:13');
    const secret = inFile('productHelper.js').find((f) => f.rule === 'JS-005')!;
    expect(secret.evidence[0].excerpt).not.toContain('sk_live');
  });

  it('finds controller issues: order search, unclosed iterator, HTTPClient', () => {
    expect(rules(inFile('Account.js'))).toEqual(['JS-002', 'JS-004', 'JS-007']);
  });

  it('finds ISML issues: encoding off, ProductMgr in isloop, remote include in isloop', () => {
    const isml = inFile('tile.isml');
    expect(rules(isml)).toEqual(['ISML-001', 'ISML-002', 'ISML-002', 'ISML-003']);
    expect(isml.find((f) => f.rule === 'ISML-002' && f.severity === 'high')?.evidence[0].location).toBe(
      'app_custom/cartridge/templates/default/product/tile.isml:4',
    );
  });

  it('reports nothing for clean code (no false positives)', () => {
    expect(inFile('app_clean/')).toEqual([]);
    expect(inFile('config.js')).toEqual([]);
  });

  it('Hyperforce: hardcoded IP and instance hostname, ignoring localhost and version strings', () => {
    const hf = analyzeHyperforceReadiness(files);
    expect(rules(hf)).toEqual(['HF-001', 'HF-002']);
    expect(hf.find((f) => f.rule === 'HF-001')!.title).toContain('10.20.30.40');
    expect(hf.find((f) => f.rule === 'HF-002')!.evidence[0].location).toBe('app_custom/cartridge/controllers/Account.js:10');
  });

  it('survives syntax errors without throwing', () => {
    expect(() => analyzeCode([{path: 'a/cartridge/x.js', content: 'function ( {{{ ProductMgr.getProduct('}])).not.toThrow();
  });
});
