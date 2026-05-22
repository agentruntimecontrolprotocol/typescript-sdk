# provisioned-credentials example (v1.1)

Demonstrates `model.use` plus a runtime-side `CredentialProvisioner`.
The server mints a deterministic bearer credential for the accepted job,
echoes it in `job.accepted`, stores only its revocation id, and revokes it
when the job completes.

## Run

In one terminal:

```sh
pnpm tsx examples/provisioned-credentials/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/provisioned-credentials/client.ts
```

## What it demonstrates

- §9.7 `model.use` lease capability.
- §9.8 `CredentialProvisioner` issue/revoke lifecycle.
- Credential constraints derived from the job lease.
- Client access via `handle.credentials`.

