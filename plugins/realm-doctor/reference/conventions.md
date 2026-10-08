# Realm Doctor: shared conventions

Every realm-doctor skill follows these rules. Read this file before running a skill.

## Tools

Two sources of data, both read-only:

1. **Official B2C MCP** (`b2c-dx-mcp` plugin). Tool names below are the short names; in Claude Code they are
   prefixed by the server name. Main tools: `config_inspect`, `logs_list_files`, `logs_get_recent`,
   `webdav_list`, `webdav_get`, `scapi_search`, `scapi_execute`, `cip_discover`, `cip_query`, `docs_search`, `docs_read`.
   Never use `cartridge_deploy`, `webdav_put`, `mrt_bundle_push` or any `debug_*` tool on production.
2. **realm-doctor CLI plugin** (shell, through the official `b2c` CLI). Always add `--json` and the instance:
   `b2c audit <command> -i <instance> --json`. Commands: `errors`, `quota`, `code`, `hyperforce`, `promotions`,
   `frontend`, `rules`. Official CLI commands also used: `b2c job search`, `b2c job log`, `b2c code list`, `b2c setup inspect`.

If a command fails with an authentication, permission or Safety Mode error, stop and report the exact message and
the missing permission (see `safety.md`). Do not retry with other credentials and do not change Safety Mode.

## Instance first

Before any analysis, confirm the target and show it at the top of the report:

- `b2c setup inspect -i <instance> --json` (or the `config_inspect` MCP tool): hostname, instance name, safety level.
- If the user did not name an instance and more than one exists, ask which one. Never guess between production and sandbox.

## Severity scale

| Severity | Criteria |
| --- | --- |
| critica | Customers cannot buy or are charged wrongly now: checkout or payment errors, enforced quota limits hit, wrong discounts on live orders |
| alta | Recurring errors or quota problems in production, a promotion that does not work as communicated, security exposure (secrets, unencoded output) |
| media | Performance degradation, problems that will become blocking (non-enforced quota, warnings near the limit), configuration inconsistencies |
| bassa | Code hygiene, cleanup, things to check when convenient |

The CLI already assigns `critical|high|medium|low` (= critica, alta, media, bassa). You may raise a severity when
the context justifies it (e.g. the error is on the checkout); say why in one line. Never lower it silently.

## Finding format

Every finding in a report uses exactly this structure:

```
### [SEVERITÀ] <RULE-ID> <titolo>
- **Evidenza:** <signature / job id / promo id / file:riga> — <dato concreto: conteggi, date, valori>
- **Impatto:** <cosa succede per il cliente o il business>
- **Fix:** <dove e cosa cambiare; in Business Manager indicare il percorso del menu>
- **Stima:** <ore o giorni-uomo, solo se ragionevole; altrimenti "da valutare">
```

## Rules of evidence

- No statement without data from a tool call made in this session. If data is missing, write "dato non disponibile" and why.
- Quote at most 3 lines of log or code per finding. Logs are already masked by the CLI; never paste raw logs fetched
  with `logs_get_recent` or `webdav_get` without removing emails, names, addresses, order and customer numbers.
- Distinguish facts (from tools) from hypotheses (your interpretation): label hypotheses "Ipotesi:".
- Use the rule ids from the CLI; for findings you derive yourself use the prefix `MAN-` and explain the logic.

## Report

Write reports in Italian unless the user writes in another language. Structure (always the same order):

1. **Header:** skill, istanza (hostname), periodo analizzato, data e ora dell'analisi.
2. **Sintesi:** 3-5 righe con il verdetto e i numeri chiave (finding per severità).
3. **Finding:** ordinati per severità, nel formato sopra.
4. **Limiti dell'analisi:** cosa non è stato possibile verificare e perché (permessi, dati mancanti, regole non coperte).
5. **Prossime azioni:** massimo 5, ognuna con un responsabile suggerito (sviluppo, business, Salesforce Support).

When the user asks for a document or the report is long, produce it as a document; otherwise answer in chat.
