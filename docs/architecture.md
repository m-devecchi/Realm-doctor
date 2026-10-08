# Architecture

Realm Doctor is a personal, read-only SFCC audit kit. Salesforce provides data access; the kit adds rules, method and report format.

```
Claude Code
 ├─ realm-doctor skills ────────── method, tool sequence, output format
 │    ├─ official MCP tools ────── b2c-dx-mcp: logs, WebDAV, SCAPI, CIP, documentation
 │    └─ shell commands ────────── b2c audit … --json (realm-doctor CLI plugin)
 │                                   └─ @salesforce/b2c-tooling-sdk: auth, WebDAV, OCAPI, Safety Mode
 └─ shared dw.json ─────────────── instances, credentials, Safety Mode READ_ONLY
                                   ↓
                         SFCC instance (read-only)
```

## Decisions

| Decision | Why |
| --- | --- |
| Use the official MCP and SDK for access and authentication | Salesforce maintains them; no access code to write or keep up to date |
| Own code only for the missing analyses | Errors by signature, quota, code rules, Hyperforce, promotions: the official toolkit does not offer them |
| A `b2c` CLI plugin instead of a custom MCP server | Inherits `dw.json` configuration, OAuth, Safety Mode and middleware; also usable from a terminal |
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
| `src/lib/cache.ts` | Local cache per host |
| `src/rules/*` | JS rules (Babel AST), ISML, Hyperforce, promotions |
| `src/commands/audit/*` | oclif commands: read data, apply rules, build the report |

## Tests

| Level | What it checks |
| --- | --- |
| Unit (fixtures) | Parsers, masking, signatures, every rule with positive cases plus a clean file to catch false positives |
| End-to-end | The compiled commands, run as processes against a fake HTTPS instance: OAuth, WebDAV, OCAPI with paging, cache, partial reads with Range, Safety Mode, no write requests |
| Configuration | Example `dw.json` valid against the official schema, complete skills, commands referenced by skills exist |

## Known limits

- The frontend is analyzed from symptoms (PageSpeed): without source maps it cannot be traced back to the source.
- Promotion qualifiers are verified only with guest baskets on a sandbox; promotions for registered customers are limited to static analysis.
- Masking does not recognize names and addresses in free text.
- Log formats can change between releases: lines the signature parser does not recognize are ignored.
- Finding titles, impacts and fixes produced by the commands are in Italian, matching the default report language.
