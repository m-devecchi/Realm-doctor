---
name: job-health
description: Health check of scheduled jobs on an SFCC instance - failed, slow, long-running or overlapping job executions with the cause from the job log. Use when the user asks "how are the jobs doing", "failed jobs", "job health", "why did job X fail", "check last night's jobs".
---

# Job health

Read `../../reference/conventions.md` (relative to this skill's folder) first.

## Inputs

- Instance (ask if ambiguous).
- Period: default last 24 hours; accept "last night", "last week", dates.
- Optional job id to focus on.

## Steps

1. Confirm the instance (`npx b2c setup inspect -i <instance> --json`).
2. Executions: `npx b2c job search -i <instance> -n 200 --sort-by start_time --sort-order desc --json`
   (add `-j <jobId>` when focused). Keep the executions inside the period.
   If the CLI is blocked by Safety Mode, use the MCP tool `scapi_execute` with the job execution search, or
   tell the user to add the `job-execution-search` allow rule (see `../../reference/safety.md`).
3. For each job id in the period compute: runs, failures (`exit_status.status` = ERROR or `execution_status` aborted),
   last duration, median duration of the runs found, max duration.
4. Classify:
   - **JOB-001 high**: last run failed, or 2+ failures in the period. **critical** if the job name suggests orders,
     payments, inventory or prices export/import (e.g. contains `order`, `export`, `inventory`, `price`, `payment`).
   - **JOB-002 medium**: last duration > 1.5 × median and > 5 minutes.
   - **JOB-003 medium**: executions of the same job overlapping in time, or still running beyond 2 × median.
   - **JOB-004 low**: job that did not run in the period although it ran regularly before (only if history shows it).
5. For each JOB-001: `npx b2c job log <jobId> <executionId> -i <instance>` (or `webdav_get` on the execution's `log_file_path`),
   read the last 100 lines, identify the failing step and the error message. Quote at most 3 lines, masked.
6. If the job log points to a cartridge script (`*/cartridge/scripts/...`), say which file; optionally run
   `npx realm-doctor audit code -i <instance> --cartridge <cartridge> --json` and attach related findings.

## Output

Report as in conventions. Add before the findings a table:

| Job | Runs | Failed | Last duration | Median | Last status |
| --- | --- | --- | --- | --- | --- |
