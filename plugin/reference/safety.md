# Access and Safety Mode

All realm-doctor analyses are read-only. They need:

| Data | Access | Used by |
| --- | --- | --- |
| Logs | WebDAV read on `/Logs` | errors, quota, incident-triage, post-deploy-check |
| Code | WebDAV read on `/Cartridges` | code, hyperforce |
| Code versions | SCAPI Scripts (`sfcc.scripts`) or OCAPI `GET /code_versions` | code, hyperforce, post-deploy-check |
| Job history | SCAPI Jobs `job-execution-search` (`sfcc.jobs`) or OCAPI `POST /job_execution_search` | job-health |
| Promotions | SCAPI Promotions, Campaigns, Coupons (`sfcc.promotions`) and Customer groups (`sfcc.customergroups`), or OCAPI `POST /sites/{site}/*_search` | promotions |
| Test baskets | SCAPI Shopper APIs as guest (SLAS client) | promo-audit, **sandbox only** |

Recommended Safety Mode policy (`config/safety.example.json` in the repo): level `READ_ONLY` plus `allow` rules for the
search POSTs only (SCAPI and OCAPI). Under plain `READ_ONLY` the searches are blocked and the jobs and promotions audits fail.
SCAPI is used first when the instance has `short-code` and `tenant-id` in dw.json; reports show `api: scapi` or `api: ocapi`.
On instances without OCAPI, SCAPI is the only way: the API client needs the Salesforce Commerce API role with the
instance's tenant and the read scopes above.

If a command fails:

- `401` / token error → wrong client id/secret or API client not enabled for the instance.
- `403` on WebDAV → add the client id to Business Manager > Administration > Organization > WebDAV Client Permissions.
- `403` on OCAPI → add the resource to the OCAPI Data API settings (Global) for the client id.
- `invalid_scope` or `403` on SCAPI → the API client lacks the Salesforce Commerce API role, the tenant in its filter, or
  the scope (`sfcc.jobs`, `sfcc.scripts`, `sfcc.promotions`, `sfcc.customergroups`).
- Safety Mode blocked → the policy is working; add only the specific `allow` rule printed in the error, never lower the level.
