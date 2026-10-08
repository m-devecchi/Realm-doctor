import {type Finding} from '../lib/finding.js';
import {analyzeHyperforce} from './hyperforce-rules.js';
import {analyzeIsml} from './isml-rules.js';
import {analyzeJs} from './js-rules.js';
import {type SourceFile} from './source.js';

export function analyzeCode(files: SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const p = f.path.toLowerCase();
    if (p.endsWith('.js') || p.endsWith('.ds')) findings.push(...analyzeJs(f));
    else if (p.endsWith('.isml')) findings.push(...analyzeIsml(f));
  }
  return findings;
}

export function analyzeHyperforceReadiness(files: SourceFile[]): Finding[] {
  return files.flatMap(analyzeHyperforce);
}

export const RULES = [
  {id: 'JS-001', severity: 'high', title: 'Expensive call (ProductMgr, OrderMgr, getVariants...) inside a loop'},
  {id: 'JS-002', severity: 'high', title: 'SeekableIterator never closed'},
  {id: 'JS-003', severity: 'medium', title: 'Transaction.wrap containing a loop'},
  {id: 'JS-004', severity: 'medium', title: 'Direct HTTPClient instead of the service framework'},
  {id: 'JS-005', severity: 'high', title: 'Hardcoded credential'},
  {id: 'JS-006', severity: 'low', title: 'Legacy importPackage / importScript'},
  {id: 'JS-007', severity: 'high', title: 'Order search from a storefront controller'},
  {id: 'JS-009', severity: 'low', title: 'Empty catch block'},
  {id: 'ISML-001', severity: 'high', title: 'isprint with encoding="off"'},
  {id: 'ISML-002', severity: 'medium/high', title: 'Business API in a template (high inside isloop)'},
  {id: 'ISML-003', severity: 'high', title: 'Remote include inside isloop'},
  {id: 'ISML-004', severity: 'low', title: 'Too many remote includes in one template'},
  {id: 'HF-001', severity: 'medium', title: 'Hardcoded IP address'},
  {id: 'HF-002', severity: 'medium', title: 'Hardcoded instance hostname'},
  {id: 'PROMO-001', severity: 'medium', title: 'Enabled promotion that can never fire'},
  {id: 'PROMO-002', severity: 'high', title: 'Orphan promotion/campaign assignment'},
  {id: 'PROMO-003', severity: 'medium/high', title: 'Promotion dates outside the campaign'},
  {id: 'PROMO-004', severity: 'high', title: 'Missing or empty customer group'},
  {id: 'PROMO-005', severity: 'high', title: 'Coupon missing, disabled, without codes or exhausted'},
  {id: 'PROMO-006', severity: 'high', title: 'Promotion currency not used by the site'},
  {id: 'PROMO-007', severity: 'high', title: 'Global exclusivity live alongside other promotions'},
  {id: 'PROMO-008', severity: 'medium', title: 'Exclusive promotions without rank or with duplicate rank'},
  {id: 'PROMO-009', severity: 'low', title: 'Same promotion live in several campaigns'},
] as const;
