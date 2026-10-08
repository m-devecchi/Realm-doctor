# Realm Doctor: instructions for AI assistants

This repository is a **read-only** audit kit for Salesforce B2C Commerce (SFCC). It works the same in GitHub Copilot
(app, VS Code, CLI) and Claude Code. Everything is in English.

## Using the kit

- Use the skills in `.claude/skills/` for audits; each one defines the steps and the report format. Shared rules are in
  `.claude/reference/conventions.md`.
- Everything is installed **locally** by `npm install` in this folder. Run commands from the repository root with `npx`:
  `npx realm-doctor audit …`, `npx b2c …`. Never run `npm install -g` and never install anything outside this folder.
- All instances of all realms are in the single `dw.json` at the repository root (git-ignored), named `<realm>-<env>`.
  Select one with `-i <name>`. If the user does not say which instance and there is more than one, ask. Never guess
  between production and sandbox.
- The official Salesforce MCP server (`b2c-dx-mcp`) is configured in `.mcp.json` and `.vscode/mcp.json` and runs from
  `node_modules`.
- Never write to an instance: no deploys, no imports, no job runs, no debugger on production, no data changes.
- Never print secrets from `dw.json` or `.env`.
- `npm run doctor` checks the installation and `dw.json`.

## Working on the code

- The kit is read-only towards SFCC. Any new instance access must use only GET/PROPFIND on WebDAV and GET or `*_search`
  on OCAPI. The e2e test "never writes to the instance" must stay green.
- Personal data must be masked with `maskPII` before caching and output.
- Every new rule: a file in `cli-plugin/src/rules/`, an entry in `RULES` (`src/rules/index.ts`), a case in the fixtures,
  a positive test, and a check that `app_clean` stays free of findings. Then regenerate `docs/rules.md` from
  `npx realm-doctor audit rules --json` (keep its current layout).
- Every new skill: a folder `.claude/skills/<name>/SKILL.md` with `name` equal to the folder, a reference to
  `../../reference/conventions.md`, and only existing `realm-doctor audit` commands. `npm test` checks this.
- Before delivering: `npm test` from the repository root.
