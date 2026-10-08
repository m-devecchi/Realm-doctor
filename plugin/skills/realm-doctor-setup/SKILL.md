---
name: realm-doctor-setup
description: Checks that the realm-doctor kit is ready (plugin or repository clone) for one or more SFCC instances - local tools, built commands, skills, MCP configuration, dw.json instances, credentials and read-only Safety Mode - and runs a live read test. Use when the user says "set up realm doctor", "check the kit", "configure instance X", "add a realm", or when another realm-doctor skill fails for configuration reasons.
---

# Realm Doctor setup check

Read `../../reference/conventions.md` and `../../reference/safety.md` (relative to this skill's folder) first.

This skill only **checks** and **explains**. It never edits `dw.json`, `.env` or credentials without the user's explicit
confirmation of the exact change, and never prints secrets. Never suggest `npm install -g`.

First find the mode (see the conventions): the `realm-doctor` MCP tools are available → **plugin**; otherwise you are
in a **repository clone**.

## Steps

1. **Installation**
   - Plugin: call `list_instances`. An error about a missing `dw.json` means the path in the plugin settings is wrong
     (Claude Code: `/plugin` > realm-doctor > configure; Copilot: run `npx github:m-devecchi/Realm-doctor install copilot --config <path>` again).
     If the `realm-doctor` tools are missing altogether, the MCP server did not start: Node.js 22+ and Git access to the
     repository are required; restart the client.
   - Repository: run `npm run doctor` from the repository root. If local tools or the build are missing, the fix is
     `npm install` in the repository root (it builds everything; nothing is installed globally).
2. **Instances**: from `list_instances` or the doctor output, list the instances and their state (hostname, default,
   Safety Mode, secret present). One `dw.json` holds every realm and environment; names follow `<realm>-<env>`
   (e.g. `acme-prd`, `acme-stg`, `globex-sbx`). Every instance must have Safety Mode `READ_ONLY`.
3. **Adding an instance** (only when asked): show the JSON block to add, copied from `config/dw.example.json` in the
   repository, with the user's hostname and client id and the same `safety` block. The secret goes in `client-secret`
   (keep the file private, git-ignored in a repository) or in the `SFCC_CLIENT_SECRET` environment variable when there
   is a single instance.
4. **Official MCP**: call the `config_inspect` tool of the B2C MCP server. Not available → in a repository, the client
   did not load `.mcp.json` (Claude Code, Copilot CLI) or `.vscode/mcp.json` (VS Code): open this repository folder and
   restart the client; with the plugin, restart the client.
5. **Live read test** (only if the user agrees), for the chosen instance: `list_code_versions` and
   `audit_errors` with `since` = `1h` (repository: `npx b2c code list -i <instance> --json` and
   `npx realm-doctor audit errors -i <instance> --since 1h --json`). Report HTTP errors with the fix from `safety.md`.

## Output

A checklist table:

| Check | Result | Note / action |
| --- | --- | --- |

Result: OK, WARN, FAIL. End with the single next action needed, if any.
