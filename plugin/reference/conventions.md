# Realm Doctor: shared conventions

Every realm-doctor skill follows these rules. Read this file before running a skill.

## Tools

Realm Doctor runs in two ways; the data and the reports are the same:

- **Plugin** (Claude Code plugin, or GitHub Copilot after `realm-doctor install copilot`): the `realm-doctor` MCP
  server provides the audit tools. There is no repository and no shell command to run.
- **Repository clone** (`npm install` at the root): the same audits as shell commands,
  `npx realm-doctor audit <command> -i <instance> --json`, run from the repository root. Never install anything globally.

Use the MCP tool when it is available; otherwise the command. Every step in the skills names the command; the matching
MCP tool takes the same options (camelCase) plus `instanceName`:

| Command (repository) | MCP tool (`realm-doctor` server) |
| --- | --- |
| `npx realm-doctor audit errors -i <instance> --since <period> --json` | `audit_errors` (`since`, `prefixes`, `day`) |
| `npx realm-doctor audit quota -i <instance> --json` | `audit_quota` (`since`) |
| `npx realm-doctor audit jobs -i <instance> --json` | `audit_jobs` (`jobId`, `count`) |
| `npx realm-doctor audit code -i <instance> --json` | `audit_code` (`codeVersion`, `cartridges`, `dir`) |
| `npx realm-doctor audit hyperforce -i <instance> --json` | `audit_hyperforce` |
| `npx realm-doctor audit promotions -i <instance> --site <site> --currency <cur> --json` | `audit_promotions` (`site`, `currencies`) |
| `npx realm-doctor audit frontend --url <url> --json` | `audit_frontend` (`urls`, `strategy`) |
| `npx realm-doctor audit rules --json` | `list_rules` |
| `npx b2c code list -i <instance> --json` | `list_code_versions` |
| `npx b2c job log <jobId> <executionId> -i <instance>` | `read_instance_file` with the execution's `log_file_path` |
| `npx b2c setup inspect -i <instance> --json` | `list_instances` |

The **official B2C MCP** server (`b2c-dx-mcp`) is available in both modes. Tool names below are the short names;
clients prefix them with the server name. Main tools: `config_inspect`, `logs_list_files`, `logs_get_recent`,
`webdav_list`, `webdav_get`, `code_version_list`, `scapi_search`, `scapi_execute`, `cip_discover`, `cip_query`,
`docs_search`, `docs_read`. Never use `cartridge_deploy`, `webdav_put`, `mrt_bundle_push` or any `debug_*` tool on
production.

All instances of all realms are in a single `dw.json` (repository root, or the file chosen in the plugin settings),
named `<realm>-<env>`. Commands select one with `-i <name>`; MCP tools with the `instanceName` parameter (same name).
Always pass it explicitly. To analyze a local copy of a client's cartridges, use `--dir <path>` (MCP: `dir`) instead.

If a command or tool fails with an authentication, permission or Safety Mode error, stop and report the exact message
and the missing permission (see `safety.md`). Do not retry with other credentials and do not change Safety Mode.

## Instance first

Before any analysis, confirm the target and show it at the top of the report:

- `list_instances` (MCP) or `npx b2c setup inspect -i <instance> --json`: instance name, hostname, Safety Mode.
- If the user did not name an instance and more than one exists, ask which one. Never guess between production and sandbox.

## Severity scale

| Severity | Criteria |
| --- | --- |
| critical | Customers cannot buy or are charged wrongly now: checkout or payment errors, enforced quota limits hit, wrong discounts on live orders |
| high | Recurring errors or quota problems in production, a promotion that does not work as communicated, security exposure (secrets, unencoded output) |
| medium | Performance degradation, problems that will become blocking (non-enforced quota, warnings near the limit), configuration inconsistencies |
| low | Code hygiene, cleanup, things to check when convenient |

The CLI already assigns `critical|high|medium|low`. You may raise a severity when the context justifies it (e.g. the
error is on the checkout); say why in one line. Never lower it silently.

## Finding format

Every finding in a report uses exactly this structure:

```
### [SEVERITY] <RULE-ID> <title>
- **Evidence:** <signature / job id / promotion id / file:line> — <concrete data: counts, dates, values>
- **Impact:** <what happens for customers or the business>
- **Fix:** <where and what to change; for Business Manager give the menu path>
- **Estimate:** <hours or person-days, only when reasonable; otherwise "to be assessed">
```

## Rules of evidence

- No statement without data from a tool call made in this session. If data is missing, write "data not available" and why.
- Quote at most 3 lines of log or code per finding. Logs are already masked by the CLI; never paste raw logs fetched
  with `logs_get_recent` or `webdav_get` without removing emails, names, addresses, order and customer numbers.
- Distinguish facts (from tools) from hypotheses (your interpretation): label hypotheses "Hypothesis:".
- Use the rule ids from the CLI; for findings you derive yourself use the prefix `MAN-` and explain the logic.

## Report

Write reports in English. Structure (always the same order):

1. **Header:** skill, instance (hostname), period analyzed, date and time of the analysis.
2. **Summary:** 3-5 lines with the verdict and the key numbers (findings by severity).
3. **Findings:** ordered by severity, in the format above.
4. **Analysis limits:** what could not be verified and why (permissions, missing data, rules not covered).
5. **Next actions:** at most 5, each with a suggested owner (development, business, Salesforce Support).

When the user asks for a document or the report is long, produce it as a document; otherwise answer in chat.
