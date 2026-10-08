# Realm Doctor: working on this repository

- Everything in this repository is in English: code, comments, finding texts (title, impact, fix), command output, skills, reports and docs.
- The kit is **read-only** towards SFCC. Any new instance access must use only GET/PROPFIND on WebDAV and GET or `*_search` on OCAPI. The e2e test "never writes to the instance" must stay green.
- Personal data must be masked with `maskPII` before caching and output.
- Every new rule: a file in `cli-plugin/src/rules/`, an entry in `RULES` (`src/rules/index.ts`), a case in the fixtures, a positive test, and a check that `app_clean` stays free of findings. Then regenerate `docs/rules.md` from `node bin/run.js audit rules --json` (keep its current layout).
- Every new skill: a folder `plugins/realm-doctor/skills/<name>/SKILL.md` with `name` equal to the folder, a reference to `../../reference/conventions.md`, and only existing `b2c audit` commands. `npm test` checks this.
- Before delivering: `cd cli-plugin && npm test`, and `claude plugin validate . --strict` from the repository root.
