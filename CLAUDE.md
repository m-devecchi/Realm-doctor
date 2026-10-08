# Realm Doctor: istruzioni per lavorare su questo repo

- Rispondi in italiano; codice, nomi di regole, commenti nel codice e SKILL.md in inglese, testi dei finding in italiano.
- Il kit è **in sola lettura** verso SFCC. Ogni nuovo accesso all'istanza deve usare solo GET/PROPFIND su WebDAV e GET o `*_search` su OCAPI. Il test e2e "never writes to the instance" deve restare verde.
- I dati personali vanno mascherati con `maskPII` prima di cache e output.
- Ogni regola nuova: file in `cli-plugin/src/rules/`, voce in `RULES` (`src/rules/index.ts`), caso nelle fixture, test positivo e verifica di assenza di falsi positivi su `app_clean`. Poi rigenera `docs/regole.md` (vedi README).
- Ogni skill nuova: cartella in `plugins/realm-doctor/skills/<nome>/SKILL.md` con `name` uguale alla cartella, riferimento a `../../reference/conventions.md`, comandi `b2c audit` esistenti. `npm test` lo verifica.
- Prima di consegnare: `cd cli-plugin && npm test` e `claude plugin validate . --strict` dalla root.
