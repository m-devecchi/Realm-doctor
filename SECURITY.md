# Security

Realm Doctor reads from Salesforce B2C Commerce instances. It never writes to them. This page says what it can reach,
what it keeps and how to report a problem.

## What it can reach

| Access | How | Needed permission |
| --- | --- | --- |
| Logs and code | WebDAV `GET` and `PROPFIND` under `/Logs` and `/Cartridges` | WebDAV read on those two folders (`config/webdav-permissions.example.json`) |
| Jobs, code versions, promotions | SCAPI Admin APIs `GET` and searches; OCAPI Data API searches as fallback | Read-only API client scopes (`config/ocapi-data-settings.example.json`) |
| Frontend | Public PageSpeed Insights API, with public storefront URLs only | none (optional `PSI_API_KEY`) |

Every instance in `dw.json` should have `safety.level` `READ_ONLY`. Salesforce's own tools then refuse any write, even if
a bug in this code tried one. `npm run doctor` fails an instance without it. The test suite records every request sent
to a fake instance and fails on anything that is not a `GET`, a `PROPFIND` or a search `POST`.

## What it keeps

- **Credentials** live only in your `dw.json` or `.env` (both git-ignored). They are never printed. `list_instances`
  returns only whether a secret exists.
- **Cache:** masked log text and code snapshots, in a folder only your user can read (`0700` / `0600`). Delete the
  folder to remove it. Logs older than 30 days can be pruned.
- **Masking** is pattern based: emails, IPs, phones, cards, long ids, IBAN, tax ids, tokens, secrets and personal fields
  (`firstName=...`). A second, independent check runs on masked text; if it still finds personal data, that log file is
  **not cached and not returned** and the report says so. Free-text names and addresses cannot be detected reliably.
  Treat a report as personal data of the client anyway.
- **Telemetry** of the Salesforce tools is off (`SFCC_DISABLE_TELEMETRY=true`).

## Rotating credentials

If a `dw.json` or `.env` was shared or committed by mistake: revoke the API client secret in Account Manager, create a new
one, update `dw.json`, and delete the cache folder. Nothing else holds the secret.

## Reporting a problem

Open a private security advisory on the repository, or write to the maintainer. Please do not put secrets, logs or
customer data in an issue.
