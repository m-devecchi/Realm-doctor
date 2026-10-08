# Realm Doctor

Kit di audit **in sola lettura** per Salesforce B2C Commerce (SFCC), da usare con Claude Code.

- I **dati** arrivano dal toolkit ufficiale di Salesforce: MCP `b2c-dx-mcp` e CLI `b2c`.
- Un **plugin della CLI** (`cli-plugin/`) aggiunge le analisi che il toolkit non fa: errori raggruppati per firma, quota, regole sul codice delle cartridge, readiness Hyperforce, promozioni configurate male, frontend.
- Un **plugin di Claude Code** (`plugins/realm-doctor/`) contiene 10 skill con metodo e formato di output fissi: chiunque le lanci ottiene lo stesso report.

Nessun database, nessun server: tutto gira in locale. Nessun comando scrive sull'istanza (verificato dai test end-to-end).

## Come si usa

In Claude Code, chiedi in linguaggio naturale oppure richiama la skill per nome:

| Skill | Quando | Esempio |
| --- | --- | --- |
| `realm-doctor-setup` | Prima volta o se qualcosa non funziona | "verifica il kit per l'istanza acme-stg" |
| `realm-weekly-review` | Stato di salute settimanale | "review settimanale di acme-prd, sito RefArch, EUR" |
| `incident-triage` | Problema in corso | "il checkout fallisce da stamattina su acme-prd" |
| `post-deploy-check` | Dopo un rilascio | "abbiamo rilasciato alle 14, com'è andata?" |
| `quota-audit` | Quote superate, prima dei picchi | "controlla le quota dell'ultima settimana" |
| `job-health` | Job falliti o lenti | "come sono andati i job stanotte?" |
| `cartridge-code-review` | Revisione del codice | "review della cartridge app_custom" |
| `frontend-check` | Sito lento, Core Web Vitals | "controlla home, PLP e PDP di www.acme.it" |
| `hyperforce-readiness` | Prima della migrazione | "siamo pronti per Hyperforce?" |
| `promo-audit` | Promo che non funzionano | "la promo AUTUMN20 non scatta, controlla" |

Ogni report ha la stessa struttura: istanza e periodo, sintesi, finding (severità, regola, evidenza, impatto, fix, stima), limiti dell'analisi, prossime azioni. Le convenzioni sono in [`plugins/realm-doctor/reference/conventions.md`](plugins/realm-doctor/reference/conventions.md).

I comandi si possono usare anche da terminale:

```bash
b2c audit errors -i acme-prd --since 7d
b2c audit quota -i acme-prd --since 7d
b2c audit code -i acme-prd --cartridge app_custom
b2c audit code --dir ./cartridges            # repo locale, senza istanza
b2c audit hyperforce -i acme-prd
b2c audit promotions -i acme-prd --site RefArch --currency EUR
b2c audit frontend --url https://www.acme.it/ --url https://www.acme.it/scarpe/
b2c audit rules                              # elenco delle regole
```

Aggiungi `--json` per l'output strutturato, che è quello che usano le skill. Elenco completo delle regole: [`docs/regole.md`](docs/regole.md).

## Installazione

Prerequisiti: Node.js 22+, Claude Code, un API Client di Account Manager per ogni istanza.

### 1. CLI ufficiale B2C

```bash
npm install -g @salesforce/b2c-cli
b2c --version
```

### 2. Plugin CLI realm-doctor

```bash
git clone git@github.com:m-devecchi/realm-doctor.git
cd realm-doctor/cli-plugin
npm ci
npm run build
b2c plugins link .
b2c audit rules
```

L'avviso "linked ESM module cannot be auto-transpiled" è normale: la CLI usa il codice già compilato in `dist/`. Dopo ogni modifica al codice esegui `npm run build`.

### 3. MCP ufficiale Salesforce (in Claude Code)

```bash
claude plugin marketplace add SalesforceCommerceCloud/b2c-developer-tooling
claude plugin install b2c-dx-mcp@b2c-developer-tooling
```

### 4. Skill realm-doctor (in Claude Code)

```bash
claude plugin marketplace add m-devecchi/realm-doctor
claude plugin install realm-doctor@realm-doctor
```

Il repo è privato: serve l'accesso Git a GitHub dalla macchina. In alternativa, da una copia locale: `claude plugin marketplace add /percorso/realm-doctor`.

### 5. Istanze e credenziali

Parti da [`config/dw.example.json`](config/dw.example.json) e crea il tuo `dw.json` nella cartella da cui lavori (è in `.gitignore`). Ogni istanza ha già Safety Mode `READ_ONLY` con le sole eccezioni necessarie.

Il client secret non va nel file: passalo con la variabile d'ambiente `SFCC_CLIENT_SECRET`, oppure salvalo con `b2c setup instance` se il tuo ambiente ha un credential store.

Permessi dell'API Client:

| Dato | Configurazione | Serve per |
| --- | --- | --- |
| Log | Business Manager > Administration > Organization > WebDAV Client Permissions: lettura su `/Logs` | errori, quota |
| Codice | WebDAV Client Permissions: lettura su `/Cartridges` | code, hyperforce |
| Code version, job, promozioni | OCAPI Data API (Global): `GET /code_versions`, `POST /job_execution_search`, `POST /sites/*/promotion_search`, `campaign_search`, `promotion_campaign_assignment_search`, `coupon_search`, `customer_group_search` | code, job, promotions |
| Carrelli di prova | SLAS client e Shopper API, **solo sandbox** | promo-audit parte 2 |

Infine, in Claude Code: "verifica il kit per l'istanza acme-stg" (skill `realm-doctor-setup`).

## Sicurezza e dati

- **Sola lettura.** I comandi usano solo `GET` e `PROPFIND` su WebDAV, `GET` e le `POST` di ricerca su OCAPI. I test end-to-end contano le richieste verso un'istanza finta e falliscono se ne compare una di scrittura. I file grandi si leggono solo in coda, con `--max-kb` e header Range.
- **Safety Mode** `READ_ONLY` è il secondo livello di protezione. I test verificano che, senza le eccezioni previste, le ricerche vengano bloccate prima di arrivare all'istanza.
- **Dati personali.** Email, IP, telefoni, numeri di carta, numeri d'ordine e cliente, token e segreti vengono mascherati prima di salvare in cache o stampare. Il mascheramento è basato su pattern: nomi e indirizzi in testo libero non sono garantiti.
- **Cache locale** in `~/.realm-doctor/cache` (oppure in `REALM_DOCTOR_CACHE`), con permessi solo utente. Contiene log mascherati e la copia del codice per code version.
- **Mai in produzione:** debugger (`debug_*`), deploy, carrelli di prova.

## Sviluppo

```bash
cd cli-plugin
npm test            # build + 55 test: unitari ed end-to-end
npm run test:unit   # solo unitari, veloci
node bin/run.js audit code --dir test/fixtures/cartridges   # esegue i comandi senza la CLI b2c
```

I test end-to-end avviano un'istanza SFCC finta in HTTPS (token Account Manager, WebDAV, OCAPI) ed eseguono i comandi veri attraverso l'SDK ufficiale. Richiedono `openssl`.

Struttura:

```
.claude-plugin/marketplace.json     marketplace di Claude Code
plugins/realm-doctor/               plugin di Claude Code: skill e convenzioni
cli-plugin/                         plugin della CLI b2c: comandi audit, regole, test
config/                             dw.json e Safety Mode di esempio
docs/                               architettura e regole
```

Per aggiungere una regola: scrivila in `cli-plugin/src/rules/`, aggiungila a `RULES` in `src/rules/index.ts`, aggiungi un caso nelle fixture e un test, poi rigenera `docs/regole.md`.

Dettagli di design in [`docs/architettura.md`](docs/architettura.md).
