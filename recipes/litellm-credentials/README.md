# LiteLLM Credentials Recipe

This recipe shows how to implement `CredentialProvisioner` with LiteLLM's
virtual key API. The SDK only defines the interface; provider-specific
HTTP calls stay here.

## Mapping

| ARCP lease field                | LiteLLM field      |
| ------------------------------- | ------------------ |
| `model.use`                     | `allowed_models`   |
| `cost.budget`                   | `max_budget`       |
| `lease_constraints.expires_at`  | key duration / TTL |

## Environment

| Variable | Description |
| -------- | ----------- |
| `LITELLM_ADMIN_KEY` | Admin key allowed to create/delete LiteLLM virtual keys. |
| `LITELLM_URL` | LiteLLM proxy base URL, default `http://127.0.0.1:4000`. |
| `ARCP_DEMO_PORT` | ARCP server port, default `7893`. |
| `ARCP_DEMO_TOKEN` | Bearer token for the demo client/server. |

Run the server with `pnpm tsx recipes/litellm-credentials/server.ts`, then
run the client with `pnpm tsx recipes/litellm-credentials/client.ts`.

