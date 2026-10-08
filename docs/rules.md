# Rules

Generated from `npx realm-doctor audit rules`. Rules PROMO-010 to PROMO-013 are checked by the `promo-audit` skill with test baskets on a sandbox, not by the command.

## Errors (audit errors)

| Rule | Severity | Description |
| --- | --- | --- |
| ERR-001 | medium..critical | New error on the evaluated day |
| ERR-002 | high/critical | Error spike (>= 3x the average of previous days) |
| ERR-003 | medium/critical | High-volume recurring error |

## Quota (audit quota)

| Rule | Severity | Description |
| --- | --- | --- |
| QUOTA-001 | critical | Enforced quota limit exceeded |
| QUOTA-002 | high | Non-enforced quota limit exceeded |
| QUOTA-003 | medium/high | Warning threshold exceeded (high above 80% of the limit) |

## Jobs (audit jobs)

| Rule | Severity | Description |
| --- | --- | --- |
| JOB-001 | high/critical | Job failing (critical when it handles orders, payments, inventory, prices or data exchange) |
| JOB-002 | medium | Job slower than usual (> 1.5x median and > 5 min) |
| JOB-003 | medium | Job running much longer than usual (> 2x median) |
| JOB-004 | medium | Overlapping executions of the same job |

## JavaScript code (audit code)

| Rule | Severity | Description |
| --- | --- | --- |
| JS-001 | high | Expensive call (ProductMgr, OrderMgr, getVariants...) inside a loop |
| JS-002 | high | SeekableIterator never closed |
| JS-003 | medium | Transaction.wrap containing a loop |
| JS-004 | medium | Direct HTTPClient instead of the service framework |
| JS-005 | high | Hardcoded credential |
| JS-006 | low | Legacy importPackage / importScript |
| JS-007 | high | Order search from a storefront controller |
| JS-009 | low | Empty catch block |

## ISML templates (audit code)

| Rule | Severity | Description |
| --- | --- | --- |
| ISML-001 | high | isprint with encoding="off" |
| ISML-002 | medium/high | Business API in a template (high inside isloop) |
| ISML-003 | high | Remote include inside isloop |
| ISML-004 | low | Too many remote includes in one template |

## Hyperforce (audit hyperforce)

| Rule | Severity | Description |
| --- | --- | --- |
| HF-001 | medium | Hardcoded IP address |
| HF-002 | medium | Hardcoded instance hostname |

## Promotions (audit promotions)

| Rule | Severity | Description |
| --- | --- | --- |
| PROMO-001 | medium | Enabled promotion that can never fire |
| PROMO-002 | high | Orphan promotion/campaign assignment |
| PROMO-003 | medium/high | Promotion dates outside the campaign |
| PROMO-004 | high | Missing or empty customer group |
| PROMO-005 | high | Coupon missing, disabled, without codes or exhausted |
| PROMO-006 | high | Promotion currency not used by the site |
| PROMO-007 | high | Global exclusivity live alongside other promotions |
| PROMO-008 | medium | Exclusive promotions without rank or with duplicate rank |
| PROMO-009 | low | Same promotion live in several campaigns |

## Frontend (audit frontend)

| Rule | Severity | Description |
| --- | --- | --- |
| FE-001 | medium/high | LCP above 2.5 s |
| FE-002 | medium/high | CLS above 0.1 |
| FE-003 | medium/high | INP above 200 ms |
| FE-004 | medium/high | Total Blocking Time above 200 ms (lab only) |
| FE-005 | low/medium | JavaScript above 1 MB or page above 3 MB |
| FE-006 | medium | Third parties blocking the main thread above 250 ms |
| FE-007 | medium | Browser console errors |

## Promotions checked on test baskets (promo-audit skill)

| Rule | Severity | Description |
| --- | --- | --- |
| PROMO-010 | high | Promotion with no qualifying products (Shopper Search pmid/pmpt) |
| PROMO-011 | high | Expected promotion not applied to the test basket |
| PROMO-012 | high | Applied discount differs from the expected one |
| PROMO-013 | critical | Discounts stacked beyond what was intended |
