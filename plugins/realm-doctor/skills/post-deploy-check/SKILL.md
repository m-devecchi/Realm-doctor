---
name: post-deploy-check
description: Compares errors and quota before and after a code deployment on an SFCC instance and gives a verdict - OK, to check, rollback recommended. Use when the user says "we released", "post-deploy check", "how did the release go", "check after go-live", or after activating a new code version.
---

# Post-deploy check

Read `../../reference/conventions.md` (relative to this skill's folder) first.

## Inputs

- Instance.
- Deploy time: ask, or derive it from `b2c code list -i <instance> --json` (`last_modification_time` / activation of the
  active version). State which one you used.
- Window: default 24 hours before vs the time elapsed after the deploy (max 24 hours). If less than 1 hour passed,
  warn that the comparison is weak.

## Steps

1. Confirm the instance and the active code version.
2. `b2c audit errors -i <instance> --since <deploy - 24h> --top 50 --json`.
3. Split each signature's `perDay` and timestamps (`firstSeen`, `lastSeen`) into before/after the deploy. Normalize per
   hour of observation. Classify:
   - **new** after the deploy (firstSeen > deploy time);
   - **regressed**: rate after ≥ 2 × rate before and ≥ 10 occurrences;
   - **fixed**: present before, absent after.
4. `b2c audit quota -i <instance> --since <deploy - 24h> --json`: new quota names after the deploy.
5. For new or regressed errors, check if `codeRefs` point to files changed in this release (ask the user for the
   list of changed cartridges if needed) and read the line with `webdav_get`.

## Verdict

- **Rollback recommended**: a new or regressed error on checkout/payment/cart pipelines, or a new enforced quota limit.
- **To check**: new or regressed errors elsewhere, new quota warnings.
- **OK**: nothing new; list the fixed errors as good news.

## Output

Report as in conventions, with the verdict in the first line of the Summary and a table:

| Signature | Before (/h) | After (/h) | Status | Where |
| --- | --- | --- | --- | --- |
