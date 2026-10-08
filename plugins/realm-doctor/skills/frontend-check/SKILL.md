---
name: frontend-check
description: Frontend performance check of an SFCC storefront - Core Web Vitals (LCP, CLS, INP), heavy JavaScript, blocking third parties and console errors on home, PLP, PDP and cart via PageSpeed Insights. Use when the user asks "the site is slow", "core web vitals", "frontend performance", "lighthouse", "pagespeed".
---

# Frontend check

Read `../../reference/conventions.md` (relative to this skill's folder) first.

## Inputs

- Storefront base URL and, ideally, one URL each for home, category (PLP), product (PDP). Ask for PLP/PDP URLs if
  missing; cart and checkout are not measurable by PageSpeed (they need a session).
- Device: mobile by default.

## Steps

1. `b2c audit frontend --url <home> --url <plp> --url <pdp> --strategy mobile --json`.
   If PageSpeed rate-limits (HTTP 429), tell the user to set `PSI_API_KEY`.
2. Field data (real users, CrUX) is more reliable than lab data: say which one each page used (`data.pages[].source`).
3. For each page, list the top third parties by blocking time and the console errors.
4. Link causes to SFCC when possible: heavy hero images from Page Designer/content assets, many remote includes
   (run `b2c audit code --json` and look for ISML-003/004 on the page templates), client bundles size.

## Output

Report as in conventions, with a table:

| Page | Source | LCP | CLS | INP | JS | Third parties (blocking) | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
