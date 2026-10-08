# Architettura

Realm Doctor è un kit personale di audit SFCC in sola lettura. Salesforce fornisce l'accesso ai dati; il kit aggiunge regole, metodo e formato dei report.

```
Claude Code
 ├─ skill realm-doctor ─────────── metodo, sequenza dei tool, formato dell'output
 │    ├─ tool MCP ufficiali ────── b2c-dx-mcp: log, WebDAV, SCAPI, CIP, documentazione
 │    └─ comandi da shell ──────── b2c audit … --json (plugin CLI realm-doctor)
 │                                   └─ @salesforce/b2c-tooling-sdk: auth, WebDAV, OCAPI, Safety Mode
 └─ dw.json condiviso ──────────── istanze, credenziali, Safety Mode READ_ONLY
                                   ↓
                         Istanza SFCC (sola lettura)
```

## Scelte

| Scelta | Perché |
| --- | --- |
| Usare MCP e SDK ufficiali per accesso e autenticazione | Salesforce li mantiene; niente codice di accesso da scrivere né aggiornare |
| Codice proprio solo per le analisi mancanti | Errori per firma, quota, regole sul codice, Hyperforce, promozioni: il toolkit ufficiale non le offre |
| Plugin della CLI `b2c` invece di un server MCP proprio | Eredita configurazione `dw.json`, OAuth, Safety Mode e middleware; si usa anche da terminale |
| Output JSON con un modello di finding unico | Le skill rendono ogni comando con lo stesso template |
| Regole deterministiche, l'LLM spiega | Risultati ripetibili e verificabili; Claude interpreta, correla e propone il fix |
| Nessun database | SFCC è la fonte dati; la cache locale evita download ripetuti |
| Download del codice con PROPFIND + GET | `downloadCartridges()` dell'SDK crea uno zip sul server (POST + DELETE), bloccato da `READ_ONLY` |
| Promozioni via OCAPI `*_search` | Le API non espongono qualificatori e criteri di sconto: quelli si verificano con carrelli di prova su sandbox |

## Moduli del plugin CLI

| Modulo | Responsabilità |
| --- | --- |
| `src/lib/logparse.ts` | Parsing delle righe di log SFCC: timestamp, livello, sito, pipeline, stack |
| `src/lib/mask.ts` | Mascheramento dei dati personali prima di cache e output |
| `src/lib/signature.ts`, `errors.ts` | Firma degli errori, aggregazione per giorno, nuovi errori e picchi |
| `src/lib/quota.ts` | Parsing e aggregazione dei messaggi di quota |
| `src/lib/frontend.ts` | Analisi della risposta di PageSpeed Insights |
| `src/lib/sfcc.ts` | Accesso in sola lettura all'istanza: log (con Range), code version, ricerche OCAPI paginate |
| `src/lib/cache.ts` | Cache locale per host |
| `src/rules/*` | Regole JS (AST Babel), ISML, Hyperforce, promozioni |
| `src/commands/audit/*` | Comandi oclif: leggono i dati, applicano le regole, producono il report |

## Test

| Livello | Cosa verifica |
| --- | --- |
| Unitari (fixture) | Parser, mascheramento, firme, ogni regola con casi positivi e un file pulito per i falsi positivi |
| End-to-end | I comandi compilati, eseguiti come processi, contro un'istanza finta HTTPS: OAuth, WebDAV, OCAPI con paginazione, cache, lettura parziale con Range, Safety Mode, nessuna richiesta di scrittura |
| Configurazione | `dw.json` di esempio valido per lo schema ufficiale, skill complete, comandi citati dalle skill esistenti |

## Limiti noti

- Il frontend si analizza dai sintomi (PageSpeed): senza source map non si risale al sorgente.
- I qualificatori delle promozioni si verificano solo con carrelli guest su sandbox; le promo per utenti registrati restano all'analisi statica.
- Il mascheramento non riconosce nomi e indirizzi in testo libero.
- Il formato dei log può variare tra release: le righe non riconosciute vengono ignorate dal parser delle firme.
