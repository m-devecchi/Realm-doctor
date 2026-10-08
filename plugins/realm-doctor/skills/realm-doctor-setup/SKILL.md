---
name: realm-doctor-setup
description: Checks that the realm-doctor kit is ready on this machine for an SFCC instance - b2c CLI, realm-doctor CLI plugin, official B2C MCP, dw.json instances, credentials and read-only Safety Mode. Use when the user says "set up realm doctor", "check the kit", "configure instance X for realm doctor", or when another realm-doctor skill fails for configuration reasons.
---

# Realm Doctor setup check

Read `../../reference/conventions.md` and `../../reference/safety.md` (relative to this skill's folder) first.

This skill only **checks** and **explains**. It never edits `dw.json`, safety files or credentials without the user's
explicit confirmation of the exact change.

## Steps

1. **b2c CLI**: `b2c --version`. Missing → tell the user to install `@salesforce/b2c-cli` (npm) and stop.
2. **realm-doctor CLI plugin**: `b2c plugins` must list `@realm-doctor/b2c-plugin-audit`. Missing → instructions from the
   repo README: `cd cli-plugin && npm install && npm run build && b2c plugins link .`
3. **Rules smoke test**: `b2c audit rules --json` returns the rule list.
4. **Official MCP**: call the `config_inspect` tool of the B2C MCP server. Not available → tell the user to install the
   `b2c-dx-mcp` plugin (see README) and restart Claude Code.
5. **Instances**: `b2c setup instance list --json` (or `b2c setup inspect --json`). For the instance the user wants:
   - hostname present;
   - credentials resolved (client id visible, secret masked);
   - Safety Mode: `b2c setup inspect -i <instance> --verbose` must show level `READ_ONLY` and the `allow` rules for
     `*_search`. If not, show the user the policy from `config/safety.example.json` and where to put it.
6. **Live read test** (only if the user agrees): `b2c code list -i <instance> --json` and
   `b2c audit errors -i <instance> --since 1h --json`. Report HTTP errors with the fix from `safety.md`.

## Output

A checklist table:

| Check | Result | Note / action |
| --- | --- | --- |

Result: OK, FAIL, TO CHECK. End with the single next action needed, if any.
