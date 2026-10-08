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

1. Confirm the instance (see "Instance first" in the conventions).
2. Jobs: `npx realm-doctor audit jobs -i <instance> --count 200 --json` (MCP `audit_jobs`; add `--job-id <jobId>` /
   `jobId` when focused). Keep the executions inside the period. It returns per-job runs, failures, durations and the
   findings:
   - **JOB-001 high**: last run failed, or 2+ failures. **critical** when the job name points to orders, payments,
     inventory, prices or data exchange (`order`, `payment`, `inventory`, `price`, `stock`, `export`, `import`).
   - **JOB-002 medium**: last duration > 1.5 × median and > 5 minutes.
   - **JOB-003 medium**: still running beyond 2 × median.
   - **JOB-004 medium**: overlapping executions of the same job.
   If it fails because of Safety Mode, tell the user to add the job search allow rules, SCAPI `job-execution-search` and OCAPI `job_execution_search` (see
   `../../reference/safety.md`).
3. For each JOB-001: read the job log at `lastLogFile` (MCP `read_instance_file`, or `npx b2c job log <jobId> <executionId> -i <instance>`),
   look at the last 100 lines, identify the failing step and the error message. Quote at most 3 lines, masked.
4. If the job log points to a cartridge script (`*/cartridge/scripts/...`), say which file; optionally run
   `npx realm-doctor audit code -i <instance> --cartridge <cartridge> --json` (MCP `audit_code`) and attach related findings.
5. Optional (MAN- finding): a job that ran regularly before and did not run in the period.

## Output

Report as in conventions. Add before the findings a table:

| Job | Runs | Failed | Last duration | Median | Last status |
| --- | --- | --- | --- | --- | --- |
