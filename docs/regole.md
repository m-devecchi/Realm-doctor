# Regole

Elenco generato da `b2c audit rules`. Le regole PROMO-010..013 sono verificate dalla skill `promo-audit` con carrelli di prova su sandbox, non dal comando.

## Errori (audit errors)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| ERR-001 | medium..critical | Nuovo errore nel giorno valutato |
| ERR-002 | high/critical | Picco di errori (>= 3x la media dei giorni precedenti) |
| ERR-003 | medium/critical | Errore ricorrente ad alto volume |

## Quota (audit quota)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| QUOTA-001 | critical | Limite di quota enforced superato |
| QUOTA-002 | high | Limite di quota non enforced superato |
| QUOTA-003 | medium/high | Soglia di warning superata (high oltre l'80% del limite) |

## Codice JavaScript (audit code)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| JS-001 | high | Chiamata costosa (ProductMgr, OrderMgr, getVariants...) dentro un ciclo |
| JS-002 | high | SeekableIterator mai chiuso |
| JS-003 | medium | Transaction.wrap che contiene un ciclo |
| JS-004 | medium | HTTPClient diretto invece del service framework |
| JS-005 | high | Credenziale hardcoded |
| JS-006 | low | importPackage / importScript legacy |
| JS-007 | high | Ricerca ordini da controller storefront |
| JS-009 | low | Blocco catch vuoto |

## Template ISML (audit code)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| ISML-001 | high | isprint con encoding="off" |
| ISML-002 | medium/high | API di business nel template (high se dentro isloop) |
| ISML-003 | high | Remote include dentro isloop |
| ISML-004 | low | Troppi remote include nello stesso template |

## Hyperforce (audit hyperforce)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| HF-001 | medium | Indirizzo IP hardcoded |
| HF-002 | medium | Hostname di istanza hardcoded |

## Promozioni (audit promotions)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| PROMO-001 | medium | Promo abilitata che non può scattare |
| PROMO-002 | high | Assegnazione promo/campagna orfana |
| PROMO-003 | medium/high | Date della promo fuori dalla campagna |
| PROMO-004 | high | Customer group inesistente o vuoto |
| PROMO-005 | high | Coupon mancante, disabilitato, senza codici o esaurito |
| PROMO-006 | high | Valuta della promo non usata dal sito |
| PROMO-007 | high | Esclusività globale insieme ad altre promo attive |
| PROMO-008 | medium | Promo esclusive senza rank o con rank duplicato |
| PROMO-009 | low | Stessa promo attiva in più campagne |

## Frontend (audit frontend)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| FE-001 | medium/high | LCP oltre 2,5 s |
| FE-002 | medium/high | CLS oltre 0,1 |
| FE-003 | medium/high | INP oltre 200 ms |
| FE-004 | medium/high | Total Blocking Time oltre 200 ms (solo lab) |
| FE-005 | low/medium | JavaScript oltre 1 MB o pagina oltre 3 MB |
| FE-006 | medium | Terze parti che bloccano il thread oltre 250 ms |
| FE-007 | medium | Errori nella console del browser |

## Promozioni verificate su carrello (skill promo-audit)

| Regola | Severità | Descrizione |
| --- | --- | --- |
| PROMO-010 | high | Promo senza prodotti che qualificano (Shopper Search pmid/pmpt) |
| PROMO-011 | high | Promo attesa ma non applicata al carrello di prova |
| PROMO-012 | high | Sconto applicato diverso da quello atteso |
| PROMO-013 | critical | Sconti cumulati oltre quanto previsto |
