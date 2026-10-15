# Changelog

## 0.4.1

- Dependencies: `@salesforce/b2c-tooling-sdk` 2.6.1, `@salesforce/b2c-cli` 2.5.2, `@salesforce/b2c-dx-mcp` 3.5.1,
  `@oclif/core` 4.14, `@babel/parser` 8, `zod` 4.6.6, TypeScript 7, `vitest` 5.0.4; GitHub Actions `checkout` and
  `setup-node` 7.
- The official MCP pin of the plugin manifest follows `package.json` (`npm run sync-official-mcp`).
- Dependabot ignores `@oclif/core` 5 (the Salesforce SDK needs 4).

## 0.4.0

- `audit errors`: short periods are judged against the 7 days before; `--split-at` gives before/after counts and rates.
- Partial reads are declared in the notes (log files, job executions, promotion records).
- `audit code` skips `app_storefront_base`, `modules` and `bm_*` unless `--include-base`.
- MCP: `instanceName` required, `compare_runs` and `audit diff`, read rules added to `READ_ONLY` instances without a
  `rules` key, text from the instance marked untrusted, credentials in code hidden.
- Masking verified by a second check; a log file that fails it is withheld.
- Settings and suppressions (`realm-doctor.json`, `realm-doctor-ignore`), report `schemaVersion` and fingerprints.
- The plugin and the install commands run the release tag, not `main`.
- Skills `cartridge-code-review` and `hyperforce-readiness` removed (the audits remain); evals for every skill.
