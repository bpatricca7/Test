# Deploying Amentum AI on Azure Government (GCC High)

This guide takes the same code you run on your PC and moves it onto the Amentum network, with
Azure OpenAI in **Azure Government** as the only outbound dependency.

```
 Amentum network                                                     │  Azure Government
                                                                     │
  Browser ──TLS──► Reverse proxy / Entra App Proxy ──► app container ─┼──► <resource>.openai.azure.us
                    (SSO, sets user header)            │  │           │     (GPT-5.6 Sol / Terra / Luna)
                                                       │  │           │
                                internal-only network ─┘  └─► MCP     ├──► login.microsoftonline.us
                                       │                     servers  │     (Entra ID tokens)
                                       ▼                  (SharePoint,│
                                 sandbox container         SQL, …)    │
                                 (code interpreter,                   │
                                  no egress, non-root)                │
```

**What leaves the network:** only HTTPS calls to your Azure OpenAI endpoint and to Entra ID for
tokens. Uploaded files, generated files, the code interpreter, conversation history, usage data
and MCP connector traffic all stay inside Amentum.

---

## 1. Provision Azure OpenAI in Azure Government

Prerequisites: Azure CLI, an Azure Government subscription, permission to create resources and
app registrations.

```bash
cd deploy/gcc-high
# edit main.bicepparam: region, deployments (model names/versions), networking
RG=rg-amentum-ai LOCATION=usgovvirginia ACCOUNT=amentum-ai-openai ./provision.sh
```

`provision.sh` switches the CLI to `AzureUSGovernment`, creates an app registration + service
principal, deploys `main.bicep` (Azure OpenAI account, model deployments, optional private
endpoint + `privatelink.openai.azure.us` DNS), and grants the service principal
**Cognitive Services OpenAI User**. It prints the values for `env/gcc-high.env`.

> **Check model availability first.** Run
> `az cognitiveservices account list-models -n <account> -g <rg> -o table` and use the model
> names/versions your Gov region actually offers. If GPT-5.6 Sol/Terra/Luna are not yet available
> there, deploy what is, and edit `config/models.json` (labels, deployment names, pricing) – no code
> changes are needed.

## 2. Authentication options (app → Azure OpenAI)

| Option | Settings | Notes |
|---|---|---|
| **Service principal + certificate** (recommended on-prem) | `AZURE_AUTH=entra`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_CERTIFICATE_PATH=/certs/amentum-ai-sp.pem` | PEM with private key; mount via `deploy/certs/` |
| Service principal + secret | `AZURE_AUTH=entra`, … `AZURE_CLIENT_SECRET` | Rotate regularly |
| Managed identity | `AZURE_AUTH=entra`, `AZURE_USE_MANAGED_IDENTITY=true` (+ `AZURE_CLIENT_ID` for user-assigned) | When hosted on an Azure Government VM / Container App |
| API key | `AZURE_AUTH=key`, `AZURE_OPENAI_API_KEY` | Requires `disableLocalAuth=false` in Bicep |

All Entra flows use authority `login.microsoftonline.us` and token scope
`https://cognitiveservices.azure.us/.default` (see `backend/app/llm/clients.py`).

**Guardrail:** with `ENFORCE_GOV_ENDPOINTS=true` (default) the app refuses to start if
`AZURE_OPENAI_ENDPOINT` is not a `*.openai.azure.us` / `*.cognitiveservices.azure.us` host, so CUI
can't be pointed at a commercial endpoint by accident.

## 3. Network egress allow-list

| Destination | Port | Purpose |
|---|---|---|
| `<account>.openai.azure.us` (or its private endpoint IP) | 443 | Model inference |
| `login.microsoftonline.us` | 443 | Entra ID tokens (not needed with API keys or managed identity) |

If egress goes through a proxy with TLS inspection:

```bash
OUTBOUND_PROXY=http://proxy.amentum.internal:8080
OUTBOUND_CA_BUNDLE=/certs/amentum-root-ca.crt     # put the PEM in deploy/certs/
```

Put the same CA (`*.crt`) in `deploy/certs/` before `docker compose build` so `pip`/`npm`/`apt`
work during image builds. Point base images at your internal registry with
`--build-arg PYTHON_IMAGE=… NODE_IMAGE=…` and apt at an internal mirror with
`--build-arg DEBIAN_MIRROR=…` if Docker Hub / Debian are not reachable.

## 4. Configure and run

```bash
cp env/gcc-high.env.example env/app.env           # fill in endpoint, tenant, client id, admins
export SANDBOX_TOKEN=$(openssl rand -hex 24)
docker compose -f docker-compose.yml -f docker-compose.gcchigh.yml up -d --build
docker compose logs -f app
```

The overlay binds the app to `127.0.0.1:8080`, makes its filesystem read-only, and mounts
`deploy/certs` at `/certs`. The sandbox runs on an `internal: true` network (no route out),
read-only, non-root, with all capabilities dropped and CPU/memory/PID limits.

## 5. Put it behind Amentum SSO

`AUTH_MODE=header` trusts `X-MS-CLIENT-PRINCIPAL-NAME` (configurable with `AUTH_USER_HEADER`).
Any of these work:

* **Microsoft Entra Application Proxy** (GCC High) publishing `http://<host>:8080` with
  pre-authentication – set the header via header-based SSO.
* **Azure App Service / Container Apps Easy Auth** in Azure Government – injects the header
  automatically.
* **nginx / IIS + ADFS or oauth2-proxy** – see `nginx.conf`; always overwrite the header so
  browsers can't spoof it, and disable buffering on `/api/chat` (streaming).

`ADMIN_USERS` (comma-separated UPNs) can see organization-wide usage and manage connectors.

## 6. Verify

1. Open the UI → **Settings → System status → Test model connection**. You should see
   "Model reachable" with latency, the `.openai.azure.us` host, `entra-id` auth and the
   `login.microsoftonline.us` authority.
2. Ask a question and expand **Thought for …** – reasoning summaries stream from the
   Responses API.
3. Attach a Word/Excel/PowerPoint file and ask for an edit + PDF printout.
4. As an admin, add an internal MCP server under **Connectors**.

Common errors (all surfaced verbatim in the chat):

| Message | Fix |
|---|---|
| `Model deployment 'x' … was not found (404)` | Deployment name mismatch → `MODEL_DEPLOYMENTS`; or the Responses API isn't enabled for that model/region → set `"api": "chat"` for it in `config/models.json`, or try `AZURE_API_STYLE=versioned` |
| `rejected the credentials (401)` | Role assignment missing or wrong tenant/client id |
| `Could not reach the model endpoint` | Egress allow-list, proxy, or CA bundle |
| `Could not get an Entra ID token` | Certificate path/secret, tenant id, or `login.microsoftonline.us` blocked |

## 7. Hardening checklist

- [ ] `AZURE_AUTH=entra`, keys disabled on the resource (`disableLocalAuth=true`)
- [ ] Private endpoint + `publicNetworkAccess=Disabled`
- [ ] `RESPONSES_STORE=false` (default) – nothing retained by the Responses API
- [ ] Review Azure OpenAI abuse-monitoring / data-retention options for your subscription
- [ ] `CONNECTORS_ADMIN_ONLY=true`, `MCP_ALLOW_STDIO=false` unless stdio servers are vetted
- [ ] App published only through the SSO proxy; header stripped from client requests
- [ ] `UI_BANNER_TEXT` set to the appropriate marking (e.g. CUI)
- [ ] `SANDBOX_TOKEN` set to a random value; sandbox network `internal: true`
- [ ] Back up the `app-data` volume (SQLite DB, files, connector config)
- [ ] Replace the placeholder pricing in `config/models.json` with your Azure Government rates

## Scaling notes

Run **one app replica** per data volume: MCP sessions, code-interpreter sessions and in-flight
streams live in-process and conversations are stored in SQLite. For more capacity, scale the host
vertically and raise `SANDBOX_MAX_SESSIONS`/sandbox limits. Horizontal scaling would need sticky
sessions plus a shared database (swap `backend/app/db.py` for Azure SQL / PostgreSQL).
