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

/** Rules of the log, quota, job and frontend audits (not code rules). */
export const OTHER_RULES = [
  {id: 'ERR-001', severity: 'medium..critical', title: 'New error on the evaluated day'},
  {id: 'ERR-002', severity: 'high/critical', title: 'Error spike (>= 3x the average of previous days)'},
  {id: 'ERR-003', severity: 'medium/critical', title: 'High-volume recurring error'},
  {id: 'QUOTA-001', severity: 'critical', title: 'Enforced quota limit exceeded'},
  {id: 'QUOTA-002', severity: 'high', title: 'Non-enforced quota limit exceeded'},
  {id: 'QUOTA-003', severity: 'medium/high', title: 'Warning threshold exceeded (high above 80% of the limit)'},
  {id: 'JOB-001', severity: 'high/critical', title: 'Job failing (critical when it handles orders, payments, inventory, prices or data exchange)'},
  {id: 'JOB-002', severity: 'medium', title: 'Job slower than usual (> 1.5x median and > 5 min)'},
  {id: 'JOB-003', severity: 'medium', title: 'Job running much longer than usual (> 2x median)'},
  {id: 'JOB-004', severity: 'medium', title: 'Overlapping executions of the same job'},
  {id: 'FE-001', severity: 'medium/high', title: 'LCP above 2.5 s'},
  {id: 'FE-002', severity: 'medium/high', title: 'CLS above 0.1'},
  {id: 'FE-003', severity: 'medium/high', title: 'INP above 200 ms'},
  {id: 'FE-004', severity: 'medium/high', title: 'Total Blocking Time above 200 ms (lab only)'},
  {id: 'FE-005', severity: 'low/medium', title: 'JavaScript above 1 MB or page above 3 MB'},
  {id: 'FE-006', severity: 'medium', title: 'Third parties blocking the main thread above 250 ms'},
  {id: 'FE-007', severity: 'medium', title: 'Browser console errors'},
];


export function allRules(): Array<{id: string; severity: string; title: string}> {
  return [...OTHER_RULES, ...RULES];
}
