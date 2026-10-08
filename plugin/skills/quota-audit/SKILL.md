---
name: quota-audit
description: Audit of SFCC platform quota violations and warnings with the code that causes them and how to fix it. Use when the user asks about "quota", "quota exceeded", "api.jsArraySize", "object quota", "governance", or before a peak (Black Friday) to check limits.
---

# Quota audit

Read `../../reference/conventions.md` (relative to this skill's folder) first.

## Inputs

- Instance (production unless specified).
- Period: default 7 days.

## Steps

1. Confirm the instance.
2. `npx realm-doctor audit quota -i <instance> --since <period> --json`.
3. For each quota in `data.quotas`, from `locations` take the site and top pipeline/controller.
4. Find the code: run `npx realm-doctor audit code -i <instance> --json` once and match findings by controller name and by
   the API in the quota name (e.g. `api.dw.catalog.ProductMgr.getProduct` ↔ rule JS-001 on `ProductMgr.getProduct`;
   `api.jsArraySize` ↔ large arrays built in loops; `object.*` ↔ queries on that object type). If no match, read the
   controller file with `webdav_get` and look for the pattern.
5. Use `docs_search` on the quota name to cite the official description and limit when useful.
6. Explain the fix in code terms (pagination, caching, search model instead of loops, close iterators).

## Output

Report as in conventions. QUOTA-001 (enforced limit) is always at least **high**, **critical** when the pipeline is
cart/checkout/order. Add a table:

| Quota | Enforced | Warn / Limit | Max observed | Times exceeded | Where |
| --- | --- | --- | --- | --- | --- |

Remind once in "Next actions" that quota overrides from Salesforce are a last resort.
