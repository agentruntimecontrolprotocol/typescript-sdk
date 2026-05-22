# Provisioned Credentials (§9.8)

Provisioned credentials let a runtime mint short-lived, scope-restricted
secrets for a job after the effective lease is finalized. The client
receives the credential in `job.accepted.payload.credentials`; the
runtime revokes it when the job reaches a terminal state.

## Runtime Setup

Configure both a `CredentialProvisioner` and a `CredentialStore`:

```ts
import {
  ARCPServer,
  InMemoryCredentialStore,
  type CredentialProvisioner,
} from "@agentruntimecontrolprotocol/sdk";

const provisioner: CredentialProvisioner = {
  async issue(ctx) {
    const models = ctx.lease["model.use"] ?? [];
    if (models.length === 0) return [];
    return [
      {
        wire: {
          id: `${ctx.jobId}:llm`,
          scheme: "bearer",
          value: "short-lived-secret",
          endpoint: "https://llm-gateway.example/v1",
          constraints: { allowed_models: [...models] },
        },
        provisionerId: `${ctx.jobId}:llm`,
      },
    ];
  },
  async revoke(_provisionerId) {},
};

const server = new ARCPServer({
  runtime: { name: "runtime", version: "1.0.0" },
  capabilities: { encodings: ["json"] },
  credentialProvisioner: provisioner,
  credentialStore: new InMemoryCredentialStore(),
});
```

`InMemoryCredentialStore` is for tests and local demos. Production
runtimes should use a durable store so revocation records survive
process restarts.

## Wire Shape

Each credential has this shape:

```ts
{
  id: string;
  scheme: "bearer";
  value: string;
  endpoint: string;
  profile?: string;
  constraints?: {
    expires_at?: string;
    allowed_models?: string[];
    max_spend?: { currency: string; amount: number };
  };
}
```

`value` is a secret. The runtime sends it only to the original job
submitter and omits it from cross-principal subscription views.

## LiteLLM Mapping

LiteLLM is the reference shape for a pluggable provider, but it is not
built into the SDK:

| ARCP field                         | LiteLLM `/key/generate` field |
| ---------------------------------- | ----------------------------- |
| `lease["model.use"]`               | `allowed_models`              |
| `lease["cost.budget"]`             | `max_budget`                  |
| `leaseConstraints.expires_at`      | key duration / expiry         |
| `Credential.provisionerId`         | LiteLLM key alias/id          |
| `Credential.endpoint`              | LiteLLM proxy base URL        |

Use `toBudgetExhausted(error, details)` in a provisioner or gateway shim
when the upstream reports a spend-cap failure; it converts the vendor
failure to ARCP `BUDGET_EXHAUSTED`.
