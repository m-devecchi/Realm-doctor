/**
 * The allow rules the audits need under Safety Mode READ_ONLY: searches and job-history reads, which are POSTs.
 * Applied by the realm-doctor MCP server when an instance has `"safety": {"level": "READ_ONLY"}` and no `rules` key,
 * so dw.json does not need the rule block. `"rules": []` means strict: nothing is added.
 * Writes (baskets, auth for test baskets) are never added here; they stay a per-instance, sandbox-only decision.
 */
import type {SafetyConfig} from '@salesforce/b2c-tooling-sdk/safety';

export const READ_ONLY_ALLOW_RULES = [
  {method: 'POST', path: '/s/-/dw/data/*/sites/*/*_search', action: 'allow'},
  {method: 'POST', path: '/s/-/dw/data/*/job_execution_search', action: 'allow'},
  {method: 'POST', path: '/operation/jobs/v1/organizations/*/job-execution-search', action: 'allow'},
  {method: 'POST', path: '/pricing/promotions/v1/organizations/*/promotions', action: 'allow'},
  {method: 'POST', path: '/pricing/campaigns/v1/organizations/*/campaigns', action: 'allow'},
  {method: 'POST', path: '/pricing/coupons/v1/organizations/*/coupons', action: 'allow'},
] as const satisfies NonNullable<SafetyConfig['rules']>;

/** `rawRules` is what dw.json says: undefined = no key (add the defaults), an array (even empty) = the user's choice. */
export function withDefaultRules<T extends {level?: string; rules?: unknown[]} | undefined>(safety: T, rawRules?: unknown[] | 'unreadable'): T {
  if (!safety || safety.level !== 'READ_ONLY' || safety.rules !== undefined || rawRules !== undefined) return safety;
  return {...safety, rules: [...READ_ONLY_ALLOW_RULES]} as T;
}
