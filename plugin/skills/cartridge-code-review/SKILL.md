---
name: cartridge-code-review
description: Static review of SFCC cartridge code (SFRA controllers, scripts, ISML) for performance, quota, security and maintainability issues, on the active code version of an instance or on a local folder. Use when the user asks "code review", "review the cartridge", "analyze cartridge X", "technical debt", "what is wrong with the code".
---

# Cartridge code review

Read `../../reference/conventions.md` (relative to this skill's folder) first.

## Inputs

- Source: an instance (active code version, read over WebDAV) **or** a local folder with cartridges.
- Optional: cartridges to include (default: all custom ones; skip `app_storefront_base` and `bm_*` unless asked).

## Steps

1. Instance: confirm it, then `npx realm-doctor audit code -i <instance> [--cartridge <name>...] --json`.
   Local folder: `npx realm-doctor audit code --dir <path> [--cartridge <name>...] --json`.
2. `npx realm-doctor audit rules --json` gives the meaning of each rule id.
3. Group findings by rule and by cartridge. For the 10 most severe, read the code around `location` (local file or
   MCP `webdav_get`) to confirm it is a real problem and not a false positive. Drop false positives and say how many.
4. For JS-001 / ISML-002 in loops, estimate the impact from the context (PLP/search templates and controllers are hot
   paths: raise to **high** if not already).
5. Use `docs_search` / `docs_read` when you cite a platform API or best practice.
6. Do not report `app_storefront_base` findings unless the user asked: list only their count.

## Output

Report as in conventions. Before the findings, a summary table:

| Rule | Description | Occurrences | Cartridges |
| --- | --- | --- | --- |

Every finding includes `file:line` and, when useful, the corrected code in a short snippet (max 15 lines).
