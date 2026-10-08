# Access and Safety Mode

All realm-doctor analyses are read-only. They need:

| Data | Access | Used by |
| --- | --- | --- |
| Logs | WebDAV read on `/Logs` | errors, quota, incident-triage, post-deploy-check |
| Code | WebDAV read on `/Cartridges` | code, hyperforce |
| Code versions | OCAPI Data `GET /code_versions` | code, hyperforce, post-deploy-check |
| Job history | OCAPI `POST /job_execution_search` or SCAPI Jobs | job-health |
| Promotions | OCAPI Data `POST /sites/{site}/*_search` (promotion, campaign, promotion_campaign_assignment, coupon, customer_group) | promotions |
| Test baskets | SCAPI Shopper APIs as guest (SLAS client) | promo-audit, **sandbox only** |

Recommended Safety Mode policy (`config/safety.example.json` in the repo): level `READ_ONLY` plus `allow` rules for the
search POSTs only. Under plain `READ_ONLY` the searches are blocked and `audit promotions` / `job search` fail.

If a command fails:

- `401` / token error → wrong client id/secret or API client not enabled for the instance.
- `403` on WebDAV → add the client id to Business Manager > Administration > Organization > WebDAV Client Permissions.
- `403` on OCAPI → add the resource to the OCAPI Data API settings (Global) for the client id.
- Safety Mode blocked → the policy is working; add only the specific `allow` rule printed in the error, never lower the level.
