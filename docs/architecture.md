# Architecture

Realm Doctor is a personal, read-only SFCC audit kit for GitHub Copilot and Claude Code. Salesforce provides data access; the kit adds rules, method and report format. It runs in two ways with the same code and skills:

- **Plugin / Copilot install**: skills plus two MCP servers started with npx (`github:m-devecchi/Realm-doctor mcp` and `@salesforce/b2c-dx-mcp`), reading a `dw.json` chosen by the user.
- **Repository clone**: everything installed locally by `npm install`; the same audits as `npx realm-doctor audit …` commands.

```
GitHub Copilot or Claude Code (this folder opened as the project)
 ├─ .claude/skills ─────────────── method, tool sequence, output format
 │    ├─ MCP tools ─────────────── b2c-dx-mcp from node_modules (.mcp.json, .vscode/mcp.json)
 │    └─ shell commands ────────── npx realm-doctor audit … --json, npx b2c …
 │                                   └─ @salesforce/b2c-tooling-sdk: auth, WebDAV, OCAPI, Safety Mode
 └─ dw.json ────────────────────── every realm and environment, credentials, Safety Mode READ_ONLY
                                   ↓
                         SFCC instance (read-only)
```

## Decisions

| Decision | Why |
| --- | --- |
| Use the official MCP and SDK for access and authentication | Salesforce maintains them; no access code to write or keep up to date |
| Own code only for the missing analyses | Errors by signature, quota, code rules, Hyperforce, promotions: the official toolkit does not offer them |
| oclif commands on the official SDK, plus an MCP server over the same functions (`src/lib/audits.ts`) | Inherit `dw.json` configuration, OAuth, Safety Mode and middleware; usable from a terminal and, through MCP, without a repository or a shell |
| MCP tools resolve the instance per call and apply its Safety Mode (`src/lib/instances.ts`) | One server for every realm, same mechanism as the official `b2c-dx-mcp` |
| Distribution with `npx github:` from the private repository (`prepare` builds) | No registry to publish to; the user's Git access is the access control |
| Everything local to the repository | `npm install` is the only step; no global packages; skills and MCP are project-level, so Copilot and Claude Code find them when the folder is opened |
| One `dw.json` for all realms | Commands take `-i <name>`, MCP tools take `instanceName`: no project per realm |
| JSON output with a single finding model | The skills render every command with the same template |
| Deterministic rules, the LLM explains | Repeatable, verifiable results; Claude interprets, correlates and proposes the fix |
| No database | SFCC is the data source; the local cache avoids repeated downloads |
| Code download with PROPFIND + GET | The SDK's `downloadCartridges()` creates a zip on the server (POST + DELETE), which `READ_ONLY` blocks |
| Promotions through OCAPI `*_search` | The APIs do not expose qualifiers and discount criteria: those are verified with test baskets on a sandbox |

## CLI plugin modules

| Module | Responsibility |
| --- | --- |
| `src/lib/logparse.ts` | Parses SFCC log lines: timestamp, level, site, pipeline, stack |
| `src/lib/mask.ts` | Masks personal data before caching and output |
| `src/lib/signature.ts`, `errors.ts` | Error signatures, daily aggregation, new errors and spikes |
| `src/lib/quota.ts` | Parses and aggregates quota messages |
| `src/lib/frontend.ts` | Analyzes the PageSpeed Insights response |
| `src/lib/audits.ts` | The audits as functions, shared by the commands and the MCP server |
| `src/lib/jobs.ts` | Job execution summary and JOB-001..004 |
| `src/lib/instances.ts` | MCP: dw.json location, per-call instance resolution, Safety Mode per instance |
| `src/commands/mcp.ts` | MCP server (stdio), read-only tools |
| `src/commands/install/copilot.ts`, `init.ts` | Copilot install (skills + MCP config) and creation of a dw.json |
| `src/lib/sfcc.ts` | Read-only instance access: logs (with Range), code versions, paged OCAPI searches |
| `src/lib/cache.ts` | Cache per host in `<repo>/.cache` |
| `src/rules/*` | JS rules (Babel AST), ISML, Hyperforce, promotions |
| `src/commands/audit/*` | oclif commands: read data, apply rules, build the report |

## Tests

| Level | What it checks |
| --- | --- |
| Unit (fixtures) | Parsers, masking, signatures, every rule with positive cases plus a clean file to catch false positives |
| End-to-end | The compiled commands and the MCP server (through a real MCP client), run as processes against a fake HTTPS instance: OAuth, WebDAV, OCAPI with paging, cache, partial reads with Range, Safety Mode per instance, no write requests. The MCP test can also run against the package installed by `npx github:` |
| Distribution | Root package runnable by npx, plugin manifest and marketplace, plugin skills identical to `.claude/`, Copilot install and removal on a temporary home, `init` |
| Configuration | Example `dw.json` valid against the official schema, multi-realm and sandbox default, complete skills, commands referenced by skills exist, local MCP config, cache inside the repository |
| Setup | `npm run doctor` checks on temporary copies; postinstall creates `dw.json` only in a clone and only when missing, does nothing when installed by npx, can be skipped in CI |

## Known limits

- The frontend is analyzed from symptoms (PageSpeed): without source maps it cannot be traced back to the source.
- Promotion qualifiers are verified only with guest baskets on a sandbox; promotions for registered customers are limited to static analysis.
- Masking does not recognize names and addresses in free text.
- Log formats can change between releases: lines the signature parser does not recognize are ignored.
