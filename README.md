# Realm Doctor

Realm Doctor checks your Salesforce B2C Commerce (SFCC) instances and explains what is wrong, inside **Claude Code** or
**GitHub Copilot**. You ask in plain language ("how did last night's jobs go on acme-prd?") and get a standard report:
what is broken, the evidence, the impact and the fix.

It checks:
- error logs: new errors, spikes, recurring errors
- quota limits
- jobs: failing, slow or stuck
- the code deployed on the instance
- Hyperforce readiness
- promotions that are set up wrong
- page speed

It **only reads**: it never changes anything on your instances.

- [Install (step by step, no technical knowledge needed)](#install)
- [Use it](#use-it)
- [Update or remove](#update-or-remove)
- [For developers: work from a clone of the repository](#for-developers-work-from-a-clone)
- [Security and data](#security-and-data)

## Install

About 15 minutes the first time. You do steps 1–3 once; step 4 depends on the assistant you use.

### 1. What you need on your computer

| What | How to check | How to get it |
| --- | --- | --- |
| **Node.js 22 or newer** | open a terminal and type `node --version`: it must print `v22…` or higher | download the **LTS** installer from [nodejs.org](https://nodejs.org) and run it |
| **Git** | `git --version` prints a version | [git-scm.com/downloads](https://git-scm.com/downloads) (on macOS it is offered automatically the first time you type `git`) |
| **Access to this GitHub repository** | `git ls-remote https://github.com/m-devecchi/Realm-doctor` prints a list of lines, no error | ask the owner to invite your GitHub account; then sign in once, for example with [GitHub Desktop](https://desktop.github.com) or `gh auth login` |
| **Claude Code** or **GitHub Copilot** | | your company's usual installation |

"Terminal" means: **Terminal** on macOS, **PowerShell** on Windows.

### 2. Create the Salesforce API client

Realm Doctor needs an API client (a client id and a password) allowed to read logs, code, jobs and promotions. It uses
the **SCAPI** Admin APIs (required on new instances, which have no OCAPI) and falls back to **OCAPI** on older ones.
Someone with Account Manager and Business Manager admin rights sets it up once: the full procedure, with the exact
settings to paste, is in **[docs/salesforce-setup.md](docs/salesforce-setup.md)**.

You get the **client id** and the **client secret** (the password), and for each instance its **short code** and
**tenant id** (Business Manager > Administration > Site Development > Salesforce Commerce API Settings).

### 3. Create your instance file (dw.json)

In a terminal:

```bash
npx github:m-devecchi/Realm-doctor init
```

The first time it takes about a minute (it downloads Realm Doctor). It creates the file **`realm-doctor/dw.json` in
your home folder**, for example `/Users/you/realm-doctor/dw.json` on macOS or `C:\Users\you\realm-doctor\dw.json` on
Windows, and prints its path.

Open that file with any text editor and replace the example instances with yours. For every instance:

```json
{
  "name": "acme-prd",
  "hostname": "production-eu01-acme.demandware.net",
  "client-id": "the client id from step 2",
  "client-secret": "the client secret from step 2",
  "short-code": "abcd1234",
  "tenant-id": "zzzz_prd",
  "safety": { … leave it as it is … }
}
```

- `name`: a short name you will use to ask for that instance: `<realm>-<environment>`, e.g. `acme-prd`, `acme-stg`.
- `hostname`: the Business Manager address, without `https://`.
- `short-code`, `tenant-id`: from step 2 (for the tenant id, the part after `f_ecom_`).
- **Do not touch the `safety` block**: it makes the tools refuse any change to the instance.
- Mark your sandbox with `"active": true`: it is the default when you do not name an instance.
- Delete the example instances you do not need. All your realms go in this one file.
- Keep the file private: it contains the secret.

### 4a. Claude Code

In Claude Code, type these two commands (one at a time):

```
/plugin marketplace add m-devecchi/Realm-doctor
/plugin install realm-doctor@realm-doctor
```

When it asks for **"dw.json with your instances"**, enter the path printed in step 3 (e.g. `/Users/you/realm-doctor/dw.json`).
Then restart Claude Code.

If it did not ask for the path, or to change it later, type `/plugin configure realm-doctor@realm-doctor` in Claude Code.

### 4b. GitHub Copilot (app, CLI)

In a terminal, with the path from step 3:

```bash
npx github:m-devecchi/Realm-doctor install copilot --config ~/realm-doctor/dw.json
```

On Windows: `--config C:\Users\you\realm-doctor\dw.json`. It copies the skills to your Copilot folder (`~/.copilot/skills`)
and adds the two servers to `~/.copilot/mcp-config.json`, keeping any other server you have. Then restart Copilot.

For **Copilot in VS Code**, use the [clone of the repository](#for-developers-work-from-a-clone) instead: open the folder
and VS Code picks up everything.

### 5. Check that it works

Ask the assistant:

> check the Realm Doctor setup for acme-stg

It lists your instances and tests the connection, and tells you exactly what is missing if something does not work.

**If the assistant says the realm-doctor tools are not available**: after an update of Realm Doctor the first start
downloads the new version (about a minute) and can take longer than the assistant waits. Run this once in a terminal,
then restart the assistant:

```bash
npx -y github:m-devecchi/Realm-doctor --version
```

**If that command fails with `Cannot find module`**: a download was interrupted halfway. Delete the folder
`~/.npm/_npx` (on Windows `%LocalAppData%\npm-cache\_npx`), run the command above again, then restart the assistant.

## Use it

Ask in plain language, or name a skill:

| Skill | When | Example |
| --- | --- | --- |
| `realm-doctor-setup` | First run, adding a realm, or when something does not work | "check the Realm Doctor setup for acme-stg" |
| `realm-weekly-review` | Weekly health check | "weekly review of acme-prd, site RefArch, EUR" |
| `incident-triage` | Live problem | "checkout has been failing since this morning on acme-prd" |
| `post-deploy-check` | After a release | "we released on globex-prd at 2 pm, how did it go?" |
| `quota-audit` | Quota violations, before traffic peaks | "check last week's quota on acme-prd" |
| `job-health` | Failed or slow jobs | "how did last night's jobs go on globex-prd?" |
| `cartridge-code-review` | Code review | "review the app_custom cartridge on acme-stg" |
| `frontend-check` | Slow site, Core Web Vitals | "check home, PLP and PDP of www.acme.com" |
| `hyperforce-readiness` | Before a migration | "is globex-prd ready for Hyperforce?" |
| `promo-audit` | Promotions that do not work | "the AUTUMN20 promotion does not fire on acme-prd" |

Always say which instance (`acme-prd`, `acme-stg`…). If you do not, the assistant asks: it never guesses between
production and sandbox.

Every report has the same structure: instance and period, summary, findings (severity, rule, evidence, impact, fix,
estimate), analysis limits and next actions. Rule list: [docs/rules.md](docs/rules.md).

## Update or remove

| | Claude Code | GitHub Copilot |
| --- | --- | --- |
| Update the skills | `claude plugin marketplace update realm-doctor` then `claude plugin update realm-doctor@realm-doctor`, then restart | run the `install copilot` command of step 4b again |
| Update the audit server | automatic: each start checks for the latest version (the first start after an update takes about a minute) | automatic, same |
| Remove | `claude plugin uninstall realm-doctor@realm-doctor` | `npx github:m-devecchi/Realm-doctor install copilot --remove` |

Your `dw.json` is never touched; delete it yourself if you no longer need it.

## For developers: work from a clone

Everything installs **inside the folder**: no global packages.

```bash
git clone git@github.com:m-devecchi/Realm-doctor.git realm-doctor
cd realm-doctor
npm install          # installs the Salesforce tools locally, builds, creates dw.json and .env from the examples
npm run doctor       # checks tools, skills, MCP config and every instance in dw.json
```

Open the folder in Claude Code or GitHub Copilot (VS Code, CLI): the skills (`.claude/skills`) and the MCP server
(`.mcp.json`, `.vscode/mcp.json`) are picked up automatically. Here `dw.json` is the one at the repository root
(git-ignored); the secret can also go in `.env` as `SFCC_CLIENT_SECRET`.

The audits also run from the terminal (add `--json` for structured output, which is what the skills use):

```bash
npx realm-doctor audit errors -i acme-prd --since 7d
npx realm-doctor audit quota -i acme-prd --since 7d
npx realm-doctor audit jobs -i acme-prd
npx realm-doctor audit code -i acme-prd --cartridge app_custom
npx realm-doctor audit code --dir ../client-repo/cartridges   # local code, no instance needed
npx realm-doctor audit hyperforce -i globex-prd
npx realm-doctor audit promotions -i acme-prd --site RefArch --currency EUR
npx realm-doctor audit frontend --url https://www.acme.com/
npx realm-doctor audit rules
npx realm-doctor mcp --config ./dw.json                       # the MCP server used by the plugin
npx b2c job search -i globex-prd --json                       # official Salesforce CLI, local too
```

Development:

```bash
npm test                          # build + unit, configuration, install and end-to-end tests
npm run test:unit -w cli-plugin   # unit tests only, fast
npm run sync-plugin               # after changing .claude/skills or .claude/reference
```

The end-to-end tests start a fake SFCC instance over HTTPS (Account Manager token, WebDAV, OCAPI) and run the real
commands and the MCP server through the official SDK. They require `openssl`.
To test the package exactly as npx installs it:
`REALM_DOCTOR_MCP_COMMAND='["npx","-y","github:m-devecchi/Realm-doctor"]' npx vitest run test/e2e/mcp.e2e.test.ts`
(in `cli-plugin/`).

Layout:

```
.claude/skills/        skills (source)
.claude/reference/     conventions and access rules used by the skills
plugin/                Claude Code plugin: manifest, MCP servers, copy of the skills (npm run sync-plugin)
.claude-plugin/        marketplace that lists the plugin
.mcp.json              MCP server for Claude Code and Copilot CLI (clone)
.vscode/mcp.json       MCP server for VS Code (clone)
AGENTS.md              instructions for AI assistants (CLAUDE.md imports it)
cli-plugin/            realm-doctor commands, MCP server, rules and tests
config/                example dw.json, Safety Mode policy, Business Manager permissions
scripts/               postinstall, doctor, sync-plugin
docs/                  Salesforce setup, architecture, rules
```

To add a rule: write it in `cli-plugin/src/rules/`, add it to `RULES` in `src/rules/index.ts`, add a case to the
fixtures and a test, then regenerate `docs/rules.md` (see `AGENTS.md`). Design details:
[docs/architecture.md](docs/architecture.md).

## Security and data

- **Read-only.** Only `GET` and `PROPFIND` on WebDAV, and `GET` plus searches on SCAPI and OCAPI (SCAPI first, OCAPI
  as fallback, like the official `b2c` CLI). The end-to-end tests
  record every request to a fake instance and fail if any write appears. Large log files are read from the end only.
- **Safety Mode** `READ_ONLY` (the `safety` block of every instance) is a second layer: the Salesforce tools themselves
  refuse any write. The tests check that a search without its exception is blocked before it reaches the instance.
- **Personal data.** Emails, IPs, phone numbers, card numbers, order and customer numbers, tokens and secrets are masked
  before caching or showing. Masking is pattern-based: free-text names and addresses are not guaranteed to be removed.
- **Secrets** stay in your `dw.json` (or `.env` in a clone). They are never printed, and `list_instances` only says
  whether a secret is present.
- **Local files.** Downloaded logs and code are cached on your computer only: `.cache/` in a clone, the plugin data
  folder for Claude Code, `~/.cache/realm-doctor` for Copilot.
- **Telemetry** of the Salesforce tools is off (`SFCC_DISABLE_TELEMETRY=true`).
- **Never on production:** the debugger (`debug_*`), deployments and test baskets.
- **Dependencies.** `npm audit` reports vulnerabilities inside the pinned dependencies of the Salesforce packages. They
  are fixed by upgrading those packages when Salesforce releases new versions, not with `npm audit fix --force`.
