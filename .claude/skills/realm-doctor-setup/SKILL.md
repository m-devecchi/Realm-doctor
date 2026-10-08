---
name: realm-doctor-setup
description: Checks that the realm-doctor kit is ready in this repository for one or more SFCC instances - local tools, built commands, skills, MCP configuration, dw.json instances, credentials and read-only Safety Mode - and runs a live read test. Use when the user says "set up realm doctor", "check the kit", "configure instance X", "add a realm", or when another realm-doctor skill fails for configuration reasons.
---

# Realm Doctor setup check

Read `../../reference/conventions.md` and `../../reference/safety.md` (relative to this skill's folder) first.

Everything lives in this repository: tools are installed locally by `npm install` (never globally), instances are in
`dw.json` at the repository root, the cache is in `.cache/`. Never suggest `npm install -g`.

This skill only **checks** and **explains**. It never edits `dw.json`, `.env` or credentials without the user's explicit
confirmation of the exact change, and never prints secrets.

## Steps

1. **Installation**: run `npm run doctor` from the repository root. If local tools or the build are missing, the fix is
   `npm install` in the repository root (it builds everything).
2. **Instances**: from the doctor output, list the instances in `dw.json` and their state. One `dw.json` holds every
   realm and environment; names follow `<realm>-<env>` (e.g. `acme-prd`, `acme-stg`, `globex-sbx`).
3. **Adding an instance** (only when asked): show the JSON block to add, copied from `config/dw.example.json`, with the
   user's hostname and client id and the same `safety` block. The secret goes in `client-secret` (the file is git-ignored)
   or in `.env` as `SFCC_CLIENT_SECRET` when there is a single instance.
4. **Official MCP**: call the `config_inspect` tool of the B2C MCP server. Not available → the client did not load
   `.mcp.json` (Claude Code, Copilot CLI) or `.vscode/mcp.json` (VS Code): make sure this repository folder is the one
   opened, then restart the client.
5. **Live read test** (only if the user agrees), for the chosen instance:
   `npx b2c code list -i <instance> --json` and `npx realm-doctor audit errors -i <instance> --since 1h --json`.
   Report HTTP errors with the fix from `safety.md`.

## Output

A checklist table:

| Check | Result | Note / action |
| --- | --- | --- |

Result: OK, WARN, FAIL. End with the single next action needed, if any.
