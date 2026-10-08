# Salesforce setup: API client and permissions

Realm Doctor reads from your instances with an **API client** (a client id and a password). You create it once in
Account Manager, then allow it on every instance. All the permissions below are **read-only**.

Which APIs it uses:

| Data | API |
| --- | --- |
| Logs, deployed code | WebDAV (every instance) |
| Code versions, jobs, promotions | **SCAPI** Admin APIs first; **OCAPI** Data API only if SCAPI is not available for that instance or client |

New instances may have no OCAPI at all: then SCAPI is required (steps 1 and 2a) and step 2c is skipped. Older instances work with either; set
up both and Realm Doctor picks SCAPI when it can. Each report shows which one answered (`api: scapi` or `api: ocapi`).

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
   | Roles | **Salesforce Commerce API**, with a **tenant filter** listing every instance to analyze (tenant ids such as `zzzz_prd`, `zzzz_stg`, `zzzz_001`; see step 2a) |
   | Allowed Scopes | `sfcc.jobs sfcc.scripts sfcc.promotions sfcc.customergroups` (read-only scopes; do **not** add the `.rw` ones). For the test baskets of the `promo-audit` skill on sandboxes, the SLAS/shopper setup is separate |
   | Token Endpoint Auth Method | `client_secret_basic` |
   | Access Token Format | `JWT` |

4. Save. Copy the **API Client ID** shown in the list (a UUID such as `3f2a9c1e-…`): **this is the `client-id`**.
5. Make sure the client is **Enabled**. New clients can take a few minutes before they work.

One API client can serve every realm of the organization; you can also create one per realm.

## 2. Allow the client on each instance (Business Manager)

Repeat for every instance you want to analyze (sandbox, staging, production).

### 2a. SCAPI: short code and tenant id

1. Business Manager > **Administration > Site Development > Salesforce Commerce API Settings**.
2. Copy the **Short Code** (e.g. `abcd1234`, the same for every instance of the realm) and the **Tenant ID / Organization
   ID** (e.g. `zzzz_prd`; shown as `f_ecom_zzzz_prd`, use the part after `f_ecom_`).
3. They go in `dw.json` as `short-code` and `tenant-id` (step 3). The tenant id must also be in the tenant filter of the
   API client role (step 1).

Nothing to enable in Business Manager for SCAPI: access comes from the role and scopes of step 1.

### 2b. Logs and code (WebDAV, every instance)

1. Business Manager > **Administration > Organization > WebDAV Client Permissions**.
2. Paste the content of [`config/webdav-permissions.example.json`](../config/webdav-permissions.example.json) with your
   client id in place of `PUT-YOUR-API-CLIENT-ID-HERE`. If the box already has other clients, add only the inner
   `{ "client_id": …, "permissions": … }` block to the existing `clients` list.
3. Save.

This gives **read** access to `/logs` (errors, quota, job logs) and `/cartridges` (deployed code). Nothing else.

### 2c. OCAPI Data API (older instances, or as fallback)

Skip this on instances without OCAPI.

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
  "short-code": "abcd1234",
  "tenant-id": "zzzz_prd",
  "safety": { "level": "READ_ONLY", "rules": [ … copy them from config/dw.example.json … ] }
}
```

- `name`: your choice, `<realm>-<env>` (e.g. `acme-prd`, `acme-stg`, `globex-sbx`). You use it to pick the instance.
- `hostname`: the Business Manager host, without `https://` and without `/on/demandware.store/…`.
- `short-code`, `tenant-id`: from step 2a. Without them only OCAPI is used.
- `safety`: keep it exactly as in the example. It makes the Salesforce tools refuse any write, even by mistake; its
  rules allow only the searches the audits need, on SCAPI and OCAPI.
- Optional `"api-backend": "ocapi"` or `"scapi"` forces one API (default `auto`: SCAPI first).

Keep `dw.json` private: it contains the secret.

## 4. Check

Ask the assistant **"check the Realm Doctor setup for acme-prd"** (skill `realm-doctor-setup`). It tells you what works
and what is missing. The usual errors:

| Message | Cause | Fix |
| --- | --- | --- |
| `401`, `invalid_client`, token error | wrong client id or password, client disabled or not yet active | check step 1; wait a few minutes after creating the client |
| `403` on `/Logs` or `/Cartridges` | WebDAV permission missing on this instance | step 2b |
| `403` on `/code_versions`, `job_execution_search`, `…_search` | OCAPI resource missing on this instance | step 2c |
| `invalid_scope`, or SCAPI `403` and then an OCAPI error | the API client lacks the role, the tenant in its filter, or a scope | step 1 (role, tenant filter, scopes) |
| report says `api: ocapi` on an instance that should use SCAPI | `short-code` or `tenant-id` missing in dw.json | step 2a |
| Safety Mode blocked | the `safety` block lacks a rule | copy the `safety` block from `config/dw.example.json` again; never lower `READ_ONLY` |
