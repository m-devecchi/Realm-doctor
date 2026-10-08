---
name: incident-triage
description: Fast triage of a live SFCC problem - correlates error signatures, quota events, jobs and the code that throws in a given time window, and proposes the probable cause and immediate actions. Use when the user says "abbiamo un problema in produzione", "il checkout non funziona", "errori da stamattina", "incident", "triage", or pastes an error message from SFCC.
---

# Incident triage

Read `../../reference/conventions.md` (relative to this skill's folder) first. Speed matters: first answer within a few
tool calls, then deepen.

## Inputs

- Instance (production by default only if the user says so; otherwise ask).
- Symptom in the user's words (e.g. "checkout fallisce", "PDP lente", an error text).
- Time window: default last 2 hours.

## Steps

1. Confirm the instance.
2. **Errors in the window**: `b2c audit errors -i <instance> --since <window> --top 20 --json`.
   Pick the signatures that match the symptom (pipeline/controller in `locations`, words in `template`).
3. **Live tail if still happening**: MCP `logs_get_recent` filtered on the matching text, to confirm the error is
   ongoing and get the latest occurrence time.
4. **Quota in the window**: `b2c audit quota -i <instance> --since <window> --json`. Quota limits on the same pipeline
   are a strong cause candidate.
5. **What changed**: `b2c code list -i <instance> --json` (code version activated recently?) and
   `b2c job search -i <instance> -n 50 --json` (imports or jobs finished just before the first occurrence?).
6. **Code**: for the top matching signature, take `codeRefs[0]` (file:line) and read that file with MCP `webdav_get`
   on `Cartridges/<activeVersion>/<file>`, around the line. Explain what the code does there.
7. Build the timeline: first occurrence, peak, changes (deploy, job, campaign start) with timestamps.

## Output

Report as in conventions, plus at the top:

- **Stato:** in corso / rientrato (from step 3).
- **Timeline** (max 8 lines).
- **Causa probabile** labelled "Ipotesi:" unless proven by evidence, with the confidence (alta/media/bassa) and why.
- **Azioni immediate** (rollback code version, disable promotion, stop job, contact PSP) separated from the
  **fix definitivo**.

Never perform the actions yourself: list them for the user.
