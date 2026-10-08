---
name: promo-audit
description: Finds misconfigured SFCC promotions and campaigns - promotions that can never fire, broken coupons and customer groups, wrong currency, exclusivity and rank conflicts - and, on a sandbox, proves the effect with test baskets. Use when the user says "promo rotte", "la promo non funziona", "controlla le promozioni", "sconto sbagliato", "coupon non valido", "verifica campagne".
---

# Promotion audit

Read `../../reference/conventions.md` and `../../reference/safety.md` (relative to this skill's folder) first.

## Inputs

- Instance and site id (e.g. `RefArch`). Ask for the site if unknown (`b2c sites list -i <instance> --json`).
- Site currencies (e.g. EUR), for the currency check.
- Optional: a specific promotion, campaign or coupon the user is worried about, and the expected behaviour in words
  ("20% sulle scarpe sopra 100 €, solo clienti VIP").

## Part 1: configuration analysis (any instance, read-only)

1. Confirm the instance.
2. `b2c audit promotions -i <instance> --site <site> --currency <cur> --json`.
3. Explain each finding in business terms (who is affected, since when). Rules: `b2c audit rules --json` (PROMO-*).
4. If the user named a promotion, focus the report on it and include every finding that mentions it.

What the API cannot show: qualifying products, discount amounts, thresholds, bonus products. Those are verified in part 2.

## Part 2: basket verification (sandbox or staging only, never production)

Run only if the instance is a sandbox/dev/staging and the user agrees. Use the official MCP SCAPI code mode
(`scapi_search` to find operations, `scapi_execute` to run them) as a guest shopper:

1. **Products in the promotion**: Shopper Search `productSearch` with `refine=pmid=<promotionId>` and
   `refine=pmpt=qualifying` (then `discounted`, `bonus`). Zero products → finding **PROMO-010 alta** "promo senza
   prodotti che qualificano" (check that products are online and in the storefront catalog).
2. **Test basket**: create a guest basket, add one qualifying product (quantity enough to pass thresholds the user
   described), apply the coupon code if the promotion needs one, read `productItems[].priceAdjustments`,
   `orderPriceAdjustments`, `shippingItems[].priceAdjustments` and `couponItems[].statusCode`.
3. Compare with the expected behaviour:
   - promotion not applied → **PROMO-011 alta** with the probable reason (coupon status, qualifier, exclusivity of a
     promotion that was applied instead);
   - discount different from expected → **PROMO-012 alta**;
   - more discounts stacked than intended (sum > what the user expects, or > 50% of the basket) → **PROMO-013 critica**.
4. Delete nothing and place no orders. Guest baskets expire on their own.

Promotions for registered customers or customer groups other than Everyone cannot be tested as guest: say so in
"Limiti dell'analisi".

## Output

Report as in conventions. For basket tests add, per test:

| Test | Prodotti | Coupon | Promo attese | Promo applicate | Sconto | Esito |
| --- | --- | --- | --- | --- | --- | --- |

Business Manager paths for fixes: Merchant Tools > Online Marketing > Campaigns / Promotions / Coupons;
Merchant Tools > Customers > Customer Groups.
