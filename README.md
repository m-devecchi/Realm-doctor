# Realm Doctor

A **read-only** audit kit for Salesforce B2C Commerce (SFCC), built for Claude Code.

- **Data** comes from Salesforce's official toolkit: the `b2c-dx-mcp` MCP server and the `b2c` CLI.
- A **CLI plugin** (`cli-plugin/`) adds the analyses the toolkit does not provide: errors grouped by signature, quota, cartridge code rules, Hyperforce readiness, misconfigured promotions and frontend checks.
- A **Claude Code plugin** (`plugins/realm-doctor/`) ships 10 skills with a fixed method and output format, so everyone running them gets the same report.

No database and no server: everything runs locally. No command writes to the instance, and the end-to-end tests enforce it.

## Usage

In Claude Code, ask in plain language or call a skill by name:

| Skill | When | Example |
| --- | --- | --- |
| `realm-doctor-setup` | First run, or when something does not work | "check the kit for instance acme-stg" |
| `realm-weekly-review` | Weekly health check | "weekly review of acme-prd, site RefArch, EUR" |
| `incident-triage` | Live problem | "checkout has been failing since this morning on acme-prd" |
| `post-deploy-check` | After a release | "we released at 2 pm, how did it go?" |
| `quota-audit` | Quota violations, before traffic peaks | "check last week's quota" |
| `job-health` | Failed or slow jobs | "how did last night's jobs go?" |
| `cartridge-code-review` | Code review | "review the app_custom cartridge" |
| `frontend-check` | Slow site, Core Web Vitals | "check home, PLP and PDP of www.acme.com" |
| `hyperforce-readiness` | Before a migration | "are we ready for Hyperforce?" |
| `promo-audit` | Promotions that do not work | "the AUTUMN20 promotion does not fire, check it" |

Every report has the same structure: instance and period, summary, findings (severity, rule, evidence, impact, fix, estimate), analysis limits and next actions. Reports are written in Italian by default, or in the language the user writes in. The conventions are in [`plugins/realm-doctor/reference/conventions.md`](plugins/realm-doctor/reference/conventions.md).

The commands also work from a terminal:

```bash
b2c audit errors -i acme-prd --since 7d
b2c audit quota -i acme-prd --since 7d
b2c audit code -i acme-prd --cartridge app_custom
b2c audit code --dir ./cartridges            # local repository, no instance needed
b2c audit hyperforce -i acme-prd
b2c audit promotions -i acme-prd --site RefArch --currency EUR
b2c audit frontend --url https://www.acme.com/ --url https://www.acme.com/shoes/
b2c audit rules                              # list of rules
```

Add `--json` for structured output; this is what the skills use. Full rule list: [`docs/rules.md`](docs/rules.md).

## Installation

Prerequisites: Node.js 22+, Claude Code, and an Account Manager API client for each instance.

### 1. Official B2C CLI

```bash
npm install -g @salesforce/b2c-cli
b2c --version
```

### 2. realm-doctor CLI plugin

```bash
git clone git@github.com:m-devecchi/Realm-doctor.git realm-doctor
cd realm-doctor/cli-plugin
npm ci
npm run build
b2c plugins link .
b2c audit rules
```

The warning "linked ESM module cannot be auto-transpiled" is expected: the CLI uses the compiled code in `dist/`. Run `npm run build` after every code change.

### 3. Official Salesforce MCP (in Claude Code)

```bash
claude plugin marketplace add SalesforceCommerceCloud/b2c-developer-tooling
claude plugin install b2c-dx-mcp@b2c-developer-tooling
```

### 4. realm-doctor skills (in Claude Code)

```bash
claude plugin marketplace add m-devecchi/Realm-doctor
claude plugin install realm-doctor@realm-doctor
```

The repository is private, so the machine needs Git access to GitHub. Alternatively, from a local copy: `claude plugin marketplace add /path/to/realm-doctor`.

### 5. Instances and credentials

Start from [`config/dw.example.json`](config/dw.example.json) and create your own `dw.json` in the folder you work from (it is in `.gitignore`). Every instance already has Safety Mode `READ_ONLY` with only the exceptions the audits need.

Do not put the client secret in the file: pass it through the `SFCC_CLIENT_SECRET` environment variable, or store it with `b2c setup instance` if your environment has a credential store.

API client permissions:

| Data | Configuration | Used by |
| --- | --- | --- |
| Logs | Business Manager > Administration > Organization > WebDAV Client Permissions: read on `/Logs` | errors, quota |
| Code | WebDAV Client Permissions: read on `/Cartridges` | code, hyperforce |
| Code versions, jobs, promotions | OCAPI Data API (Global): `GET /code_versions`, `POST /job_execution_search`, `POST /sites/*/promotion_search`, `campaign_search`, `promotion_campaign_assignment_search`, `coupon_search`, `customer_group_search` | code, jobs, promotions |
| Test baskets | SLAS client and Shopper APIs, **sandbox only** | promo-audit part 2 |

Finally, in Claude Code: "check the kit for instance acme-stg" (the `realm-doctor-setup` skill).

## Security and data

- **Read-only.** Commands only use `GET` and `PROPFIND` on WebDAV, and `GET` plus search `POST`s on OCAPI. The end-to-end tests record every request to a fake instance and fail if any write appears. Large log files are read from the tail only, with `--max-kb` and an HTTP Range header.
- **Safety Mode** `READ_ONLY` is a second layer of protection. The tests check that, without the expected exceptions, searches are blocked before they reach the instance.
- **Personal data.** Emails, IPs, phone numbers, card numbers, order and customer numbers, tokens and secrets are masked before caching or printing. Masking is pattern-based: free-text names and addresses are not guaranteed to be removed.
- **Local cache** in `~/.realm-doctor/cache` (or `REALM_DOCTOR_CACHE`), readable by the user only. It holds masked logs and a copy of the code per code version.
- **Never on production:** the debugger (`debug_*`), deployments and test baskets.

## Development

```bash
cd cli-plugin
npm test            # build + 55 tests: unit, configuration and end-to-end
npm run test:unit   # unit tests only, fast
node bin/run.js audit code --dir test/fixtures/cartridges   # runs the commands without the b2c CLI
```

The end-to-end tests start a fake SFCC instance over HTTPS (Account Manager token, WebDAV, OCAPI) and run the real commands through the official SDK. They require `openssl`.

Layout:

```
.claude-plugin/marketplace.json     Claude Code marketplace
plugins/realm-doctor/               Claude Code plugin: skills and conventions
cli-plugin/                         b2c CLI plugin: audit commands, rules, tests
config/                             example dw.json and Safety Mode policy
docs/                               architecture and rules
```

To add a rule: write it in `cli-plugin/src/rules/`, add it to `RULES` in `src/rules/index.ts`, add a case to the fixtures and a test, then regenerate `docs/rules.md` (see `CLAUDE.md`).

Design details: [`docs/architecture.md`](docs/architecture.md).
