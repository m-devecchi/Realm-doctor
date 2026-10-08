---
name: realm-weekly-review
description: Weekly health review of an SFCC realm combining errors, quota, jobs, slow or failing APIs and promotions into one report with the top 5 problems and actions. Use when the user asks "weekly review", "how is the realm doing", "instance health", "weekly report".
---

# Realm weekly review

Read `../../reference/conventions.md` (relative to this skill's folder) first. This skill composes the others: run
the commands below, do not re-run the full sub-skills.

## Inputs

- Instance (production).
- Week: default the last 7 days ending now.
- Site id(s) for promotions; currencies.

## Steps

1. Confirm the instance.
2. Errors: `npx realm-doctor audit errors -i <instance> --since 7d --top 20 --json`.
3. Quota: `npx realm-doctor audit quota -i <instance> --since 7d --json`.
4. Jobs: `npx b2c job search -i <instance> -n 200 --json`; failures and slow runs as in the `job-health` skill (no log reading
   unless a job failed 2+ times).
5. APIs (if CIP is available for the tenant): MCP `cip_discover` for the technical reports, then `cip_query` for
   SCAPI/OCAPI endpoints with the highest 5xx rate and latency in the week. Skip with a note if not available.
6. Promotions: `npx realm-doctor audit promotions -i <instance> --site <site> --currency <cur> --json` for each site.
7. Merge all findings, de-duplicate (same cause seen in errors and quota = one finding with both evidences), rank by
   severity then volume.

## Output

Report as in conventions, with this Summary structure:

- **Verdict:** stable / to monitor / critical, in one sentence.
- **Top 5 problems** (one line each with severity and rule id).
- **Compared with last week:** only if the user provides last week's report or the data covers it; otherwise omit.

Then a short section per area (Errors, Quota, Jobs, APIs, Promotions) with at most 3 findings each, and the full list of
remaining findings in an appendix table:

| Severity | Rule | Title | Evidence |
| --- | --- | --- | --- |
