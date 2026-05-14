# Custom auth verifier

All other examples use `StaticBearerVerifier`, a token → identity map. In
production you want to delegate to a real auth provider: a JWKS endpoint, a
JWT library, or an HTTP call to a session service. This example shows the
seam: a `BearerVerifier` implementation that validates a stateless,
HMAC-signed token.

Tokens are formatted `principal.expEpoch.hmac`. The server's
`SignedTokenVerifier` recomputes the HMAC over `principal.expEpoch` with a
shared secret and rejects anything whose signature or expiry doesn't check
out. Swap the body of `verify()` for a real JWKS lookup, an HTTP call, or a
JWT library — the seam is the same.

## Run

In one terminal:

```sh
pnpm tsx examples/custom-auth/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/custom-auth/client.ts
```

The client mints a valid token, runs a job, then attempts a second
handshake with a forged token and reports the rejection.

## What it demonstrates

- §6.1 the `bearer` auth scheme is the wire shape; verifier behind it is
  the deployment's call.
- The `BearerVerifier` interface as the integration seam for JWT/JWKS/HTTP
  auth providers.
- Handshake rejection (`session.error` with `UNAUTHENTICATED`) when the
  verifier throws.

## Configuration

| Env var            | Default                    | Used by |
| ------------------ | -------------------------- | ------- |
| `ARCP_DEMO_PORT`   | `7894`                     | server  |
| `ARCP_DEMO_URL`    | `ws://127.0.0.1:7894/arcp` | client  |
| `ARCP_DEMO_SECRET` | `demo-secret`              | both    |
