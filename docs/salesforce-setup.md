# Salesforce setup: API client and permissions

Realm Doctor reads from your instances with an **API client** (a client id and a password). You create it once in
Account Manager, then allow it on every instance in Business Manager. All the permissions below are **read-only**.

You need: an Account Manager user who can manage API clients (usually the *Account Administrator* or *API Client
Administrator* role), and Business Manager *Administrator* access on each instance.

## 1. Create the API client (Account Manager)

1. Sign in to Account Manager (`https://account.demandware.com`).
2. Open **API Client** and click **Add API Client**.
3. Fill in:

   | Field | Value |
   | --- | --- |
   | Display Name | `Realm Doctor (read-only)` |
   | Password | a long random password. **This is the `client-secret`**: save it in your password manager now, you cannot read it again later |
   | Organizations | the organization that owns the realms to analyze |
   | Roles | none needed for the audits. Optional: **Salesforce Commerce API** with the tenant filter of your **sandbox** tenants (e.g. `zzzz_001`) only if you want the promotion test baskets of the `promo-audit` skill |
   | Token Endpoint Auth Method | `client_secret_basic` |
   | Access Token Format | `JWT` |

4. Save. Copy the **API Client ID** shown in the list (a UUID such as `3f2a9c1e-…`): **this is the `client-id`**.
5. Make sure the client is **Enabled**. New clients can take a few minutes before they work.

One API client can serve every realm of the organization; you can also create one per realm.

## 2. Allow the client on each instance (Business Manager)

Repeat for every instance you want to analyze (sandbox, staging, production).

### Logs and code (WebDAV)

1. Business Manager > **Administration > Organization > WebDAV Client Permissions**.
2. Paste the content of [`config/webdav-permissions.example.json`](../config/webdav-permissions.example.json) with your
   client id in place of `PUT-YOUR-API-CLIENT-ID-HERE`. If the box already has other clients, add only the inner
   `{ "client_id": …, "permissions": … }` block to the existing `clients` list.
3. Save.

This gives **read** access to `/logs` (errors, quota, job logs) and `/cartridges` (deployed code). Nothing else.

### Code versions, jobs, promotions (OCAPI Data API)

1. Business Manager > **Administration > Site Development > Open Commerce API Settings**.
2. Select type **Data** and context **Global (organization-wide)**.
3. Paste the content of [`config/ocapi-data-settings.example.json`](../config/ocapi-data-settings.example.json) with
   your client id. If the box already has other clients, add only your `{ "client_id": …, "resources": … }` block to the
   existing `clients` list.
4. Save. Changes can take up to 3 minutes to apply.

Every resource is a `GET` or a search (`POST …_search`): searches read data, they do not change it.

## 3. Add the instance to your dw.json

```json
{
  "name": "acme-prd",
  "hostname": "production-eu01-acme.demandware.net",
  "client-id": "the API Client ID from step 1",
  "client-secret": "the password from step 1",
  "safety": { "level": "READ_ONLY", "rules": [ … copy them from config/dw.example.json … ] }
}
```

- `name`: your choice, `<realm>-<env>` (e.g. `acme-prd`, `acme-stg`, `globex-sbx`). You use it to pick the instance.
- `hostname`: the Business Manager host, without `https://` and without `/on/demandware.store/…`.
- `safety`: keep it exactly as in the example. It makes the Salesforce tools refuse any write, even by mistake.

Keep `dw.json` private: it contains the secret.

## 4. Check

Ask the assistant **"check the Realm Doctor setup for acme-prd"** (skill `realm-doctor-setup`). It tells you what works
and what is missing. The usual errors:

| Message | Cause | Fix |
| --- | --- | --- |
| `401`, `invalid_client`, token error | wrong client id or password, client disabled or not yet active | check step 1; wait a few minutes after creating the client |
| `403` on `/Logs` or `/Cartridges` | WebDAV permission missing on this instance | step 2, WebDAV |
| `403` on `/code_versions`, `job_execution_search`, `…_search` | OCAPI resource missing on this instance | step 2, OCAPI |
| Safety Mode blocked | the `safety` block lacks a rule | copy the `safety` block from `config/dw.example.json` again; never lower `READ_ONLY` |
