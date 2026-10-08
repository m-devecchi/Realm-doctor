---
name: hyperforce-readiness
description: Readiness check before migrating an SFCC realm from a POD to Hyperforce - hardcoded IPs and hostnames in cartridges, integrations to verify, and a migration checklist. Use when the user mentions "Hyperforce", "migrazione POD", "readiness", "cambio IP", "migrazione realm".
---

# Hyperforce readiness

Read `../../reference/conventions.md` (relative to this skill's folder) first.

## Inputs

- Instance (production code version is the reference; staging if production is not accessible).
- Optional: list of external systems (ERP, OMS, PSP, CRM, WAF/CDN, marketing) from the user.

## Steps

1. Confirm the instance.
2. `b2c audit hyperforce -i <instance> --json`: findings HF-001 (IP) and HF-002 (instance hostnames) plus `data.checklist`.
3. For each finding, read the line with `webdav_get` and say which integration it belongs to.
4. Services: ask the user to export or list the services configured in Business Manager (Administration > Operations >
   Services) if not available; check their endpoints for IPs and instance hostnames.
5. Use `docs_search` "Hyperforce migration" to cite official guidance when relevant.

## Output

Report as in conventions plus the migration checklist:

| Voce | Esito | Azione | Responsabile |
| --- | --- | --- | --- |

Esito OK / KO / DA VERIFICARE. Items that cannot be checked from code (allowlists at partners, inbound integrations,
mTLS certificates) are always DA VERIFICARE with the person to ask.
