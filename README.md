# Realm Doctor

A **read-only** audit kit for Salesforce B2C Commerce (SFCC). It works with **GitHub Copilot** (app, VS Code, CLI) and **Claude Code**, and everything installs **inside this folder**: no global packages, nothing to install by hand.

- **Data** comes from Salesforce's official toolkit: the `b2c` CLI and the `b2c-dx-mcp` MCP server, both installed locally.
- **realm-doctor commands** (`cli-plugin/`) add the analyses the toolkit does not provide: errors grouped by signature, quota, cartridge code rules, Hyperforce readiness, misconfigured promotions and frontend checks.
- **10 skills** (`.claude/skills/`, read by both Copilot and Claude Code) fix the method and the report format, so everyone gets the same report.

No database and no server. No command writes to an SFCC instance, and the end-to-end tests enforce it.

## Quick start

Prerequisites: Node.js 22+ and Git.

```bash
git clone git@github.com:m-devecchi/Realm-doctor.git realm-doctor
cd realm-doctor
npm install
```

`npm install` does everything, locally:

1. installs the Salesforce `b2c` CLI and the `b2c-dx-mcp` MCP server in `node_modules`;
2. builds the `realm-doctor` commands;
3. creates `dw.json` from [`config/dw.example.json`](config/dw.example.json) and `.env` from [`config/env.example`](config/env.example) if they do not exist (`.env` turns Salesforce CLI telemetry off).

Then:

1. Put your instances in `dw.json` (see below).
2. Run `npm run doctor` to check everything.
3. Open **this folder** in GitHub Copilot or Claude Code. The skills (`.claude/skills`) and the MCP server (`.mcp.json`, `.vscode/mcp.json`) are picked up automatically; approve the MCP server when the client asks.

Deleting the folder removes everything. Outside it, the Salesforce tools only keep a few small files of their own in your home folder (token cache, version check).

## Instances: one file for every realm

All instances of all realms live in the single `dw.json` at the repository root (git-ignored). Name them `<realm>-<env>`:

```json
{
  "configs": [
    {"name": "acme-sbx", "active": true, "hostname": "zzzz-001.dx.commercecloud.salesforce.com", "client-id": "…", "client-secret": "…", "safety": {"…": "…"}},
    {"name": "acme-prd", "hostname": "production-eu01-acme.demandware.net", "client-id": "…", "client-secret": "…", "safety": {"…": "…"}},
    {"name": "globex-stg", "hostname": "staging-eu02-globex.demandware.net", "client-id": "…", "client-secret": "…", "safety": {"…": "…"}}
  ]
}
```

- Commands select an instance with `-i acme-prd`; MCP tools with `instanceName`. Skills always ask when the instance is not clear, and never guess between production and sandbox.
- The instance marked `active` is the default; keep it a sandbox.
- Copy the `safety` block from the example for every instance: Safety Mode `READ_ONLY` plus only the exceptions the audits need.
- The secret can stay in `client-secret` (the file is git-ignored) or go in a local `.env` as `SFCC_CLIENT_SECRET`.

API client permissions:

| Data | Configuration | Used by |
| --- | --- | --- |
| Logs | Business Manager > Administration > Organization > WebDAV Client Permissions: read on `/Logs` | errors, quota |
| Code | WebDAV Client Permissions: read on `/Cartridges` | code, hyperforce |
| Code versions, jobs, promotions | OCAPI Data API (Global): `GET /code_versions`, `POST /job_execution_search`, `POST /sites/*/promotion_search`, `campaign_search`, `promotion_campaign_assignment_search`, `coupon_search`, `customer_group_search` | code, jobs, promotions |
| Test baskets | SLAS client and Shopper APIs, **sandbox only** | promo-audit part 2 |

## Usage

Ask in plain language or call a skill by name:

| Skill | When | Example |
| --- | --- | --- |
| `realm-doctor-setup` | First run, adding a realm, or when something does not work | "check the kit for instance acme-stg" |
| `realm-weekly-review` | Weekly health check | "weekly review of acme-prd, site RefArch, EUR" |
| `incident-triage` | Live problem | "checkout has been failing since this morning on acme-prd" |
| `post-deploy-check` | After a release | "we released on globex-prd at 2 pm, how did it go?" |
| `quota-audit` | Quota violations, before traffic peaks | "check last week's quota on acme-prd" |
| `job-health` | Failed or slow jobs | "how did last night's jobs go on globex-prd?" |
| `cartridge-code-review` | Code review | "review the app_custom cartridge on acme-stg" |
| `frontend-check` | Slow site, Core Web Vitals | "check home, PLP and PDP of www.acme.com" |
| `hyperforce-readiness` | Before a migration | "is globex-prd ready for Hyperforce?" |
| `promo-audit` | Promotions that do not work | "the AUTUMN20 promotion does not fire on acme-prd" |

Every report has the same structure: instance and period, summary, findings (severity, rule, evidence, impact, fix, estimate), analysis limits and next actions. Conventions: [`.claude/reference/conventions.md`](.claude/reference/conventions.md).

The commands also work from a terminal, in this folder:

```bash
npx realm-doctor audit errors -i acme-prd --since 7d
npx realm-doctor audit quota -i acme-prd --since 7d
npx realm-doctor audit code -i acme-prd --cartridge app_custom
npx realm-doctor audit code --dir ../client-repo/cartridges   # local code, no instance needed
npx realm-doctor audit hyperforce -i globex-prd
npx realm-doctor audit promotions -i acme-prd --site RefArch --currency EUR
npx realm-doctor audit frontend --url https://www.acme.com/ --url https://www.acme.com/shoes/
npx realm-doctor audit rules
npx b2c job search -i globex-prd --json                       # official Salesforce CLI, local too
```

Add `--json` for structured output; this is what the skills use. Full rule list: [`docs/rules.md`](docs/rules.md).

## Security and data

- **Read-only.** Commands only use `GET` and `PROPFIND` on WebDAV, and `GET` plus search `POST`s on OCAPI. The end-to-end tests record every request to a fake instance and fail if any write appears. Large log files are read from the tail only, with `--max-kb` and an HTTP Range header.
- **Safety Mode** `READ_ONLY` is a second layer of protection. The tests check that, without the expected exceptions, searches are blocked before they reach the instance.
- **Personal data.** Emails, IPs, phone numbers, card numbers, order and customer numbers, tokens and secrets are masked before caching or printing. Masking is pattern-based: free-text names and addresses are not guaranteed to be removed.
- **Local files.** `dw.json`, `.env` and the cache (`.cache/`) stay in this folder and are git-ignored. `npm run doctor` fails if they are not.
- **Telemetry.** Salesforce CLI and MCP telemetry is off (`SFCC_DISABLE_TELEMETRY=true` in `.env` and in the MCP configs).
- **Never on production:** the debugger (`debug_*`), deployments and test baskets.
- **Dependencies.** `npm audit` reports vulnerabilities inside the pinned dependencies of the Salesforce packages (`@salesforce/b2c-cli`, `@salesforce/b2c-dx-mcp`, `@salesforce/b2c-tooling-sdk`). They are fixed by upgrading those packages when Salesforce releases new versions, not with `npm audit fix --force`.

## Updating

```bash
git pull
npm install
```

## Development

```bash
npm test                          # build + unit, configuration, setup and end-to-end tests
npm run test:unit -w cli-plugin   # unit tests only, fast
npx realm-doctor audit code --dir cli-plugin/test/fixtures/cartridges
```

The end-to-end tests start a fake SFCC instance over HTTPS (Account Manager token, WebDAV, OCAPI) and run the real commands through the official SDK. They require `openssl`.

Layout:

```
.claude/skills/        skills (GitHub Copilot and Claude Code)
.claude/reference/     shared conventions and access rules used by the skills
.mcp.json              MCP server for Claude Code and Copilot CLI
.vscode/mcp.json       MCP server for VS Code
AGENTS.md              instructions for AI assistants (CLAUDE.md imports it)
cli-plugin/            realm-doctor commands, rules and tests
config/                example dw.json and Safety Mode policy
scripts/               postinstall and doctor
docs/                  architecture and rules
```

To add a rule: write it in `cli-plugin/src/rules/`, add it to `RULES` in `src/rules/index.ts`, add a case to the fixtures and a test, then regenerate `docs/rules.md` (see `AGENTS.md`).

Design details: [`docs/architecture.md`](docs/architecture.md).
