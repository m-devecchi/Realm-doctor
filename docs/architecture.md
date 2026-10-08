# Architecture

Realm Doctor is a personal, read-only SFCC audit kit for GitHub Copilot and Claude Code. Salesforce provides data access; the kit adds rules, method and report format. Everything is installed locally in the repository by `npm install`.

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
| oclif commands on the official SDK instead of a custom MCP server | Inherit `dw.json` configuration, OAuth, Safety Mode and middleware; usable from a terminal and by any assistant that runs shell commands |
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
| `src/lib/sfcc.ts` | Read-only instance access: logs (with Range), code versions, paged OCAPI searches |
| `src/lib/cache.ts` | Cache per host in `<repo>/.cache` |
| `src/rules/*` | JS rules (Babel AST), ISML, Hyperforce, promotions |
| `src/commands/audit/*` | oclif commands: read data, apply rules, build the report |

## Tests

| Level | What it checks |
| --- | --- |
| Unit (fixtures) | Parsers, masking, signatures, every rule with positive cases plus a clean file to catch false positives |
| End-to-end | The compiled commands, run as processes against a fake HTTPS instance: OAuth, WebDAV, OCAPI with paging, cache, partial reads with Range, Safety Mode, no write requests |
| Configuration | Example `dw.json` valid against the official schema, multi-realm and sandbox default, complete skills, commands referenced by skills exist, local MCP config, cache inside the repository |
| Setup | `npm run doctor` checks on temporary copies; postinstall builds, creates `dw.json` only when missing, can be skipped in CI |

## Known limits

- The frontend is analyzed from symptoms (PageSpeed): without source maps it cannot be traced back to the source.
- Promotion qualifiers are verified only with guest baskets on a sandbox; promotions for registered customers are limited to static analysis.
- Masking does not recognize names and addresses in free text.
- Log formats can change between releases: lines the signature parser does not recognize are ignored.
