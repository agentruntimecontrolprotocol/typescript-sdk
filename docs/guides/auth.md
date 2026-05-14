# Authentication (§6.1)

ARCP v1.0 supports a single auth scheme: bearer tokens. The client
sends a token in `session.hello`; the runtime verifies it via a
`BearerVerifier` and binds the resulting identity to the session.

## Client side

```ts
const client = new ARCPClient({
  client: { name: "my-client", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env.TOKEN,
});
```

The token is sent inside `session.hello.payload.auth`, not as an HTTP
header. That keeps auth orthogonal to transport — works the same over
WebSocket, stdio, or in-memory.

## Static tokens (development, tests)

`StaticBearerVerifier` accepts a map of `token → identity`:

```ts
import { StaticBearerVerifier } from "@arcp/sdk";

const bearer = new StaticBearerVerifier(
  new Map([
    ["tok-alice", { principal: "alice@example.com" }],
    ["tok-bob",   { principal: "bob@example.com" }],
  ]),
);

const server = new ARCPServer({ /* … */, bearer });
```

Each `BearerIdentity` carries:

```ts
type BearerIdentity = {
  principal: string;
  entitlements?: {
    sessions?: readonly string[]; // restrict resume to these session ids
    traces?: readonly string[];   // restrict trace_id visibility
  };
};
```

## Custom verifier

For real deployments, write your own verifier. The contract is one
async method:

```ts
import type { BearerVerifier, BearerIdentity } from "@arcp/core";

class JwtVerifier implements BearerVerifier {
  constructor(private readonly jwks: JwksClient) {}

  async verify(token: string): Promise<BearerIdentity> {
    const decoded = await this.jwks.verify(token, {
      issuer: "https://idp.example.com/",
      audience: "arcp",
    });
    return {
      principal: decoded.sub!,
      entitlements: {
        traces: decoded.entitlements?.traces,
      },
    };
  }
}

const server = new ARCPServer({
  // …
  bearer: new JwtVerifier(jwks),
});
```

Throw any error from `verify()` to reject the handshake — the runtime
emits `session.error { code: "UNAUTHENTICATED" }` and closes the
transport. Throwing `PermissionDeniedError` instead of a generic error
distinguishes "good token, no access" from "bad token."

## Where the principal lives

Once verified, the principal is attached to the session and to every
job submitted within it. Inside an agent handler:

```ts
server.registerAgent("introspect", async (input, ctx) => {
  // ctx.sessionId — for diagnostics
  // ctx.lease — capability grant for this job
  // The principal is on the parent Job: ctx.job.submitterPrincipal
  return { ok: true };
});
```

The `ARCPServerOptions.jobAuthorizationPolicy` lets you gate jobs on
principal — same-principal-only is the default:

```ts
new ARCPServer({
  // …
  jobAuthorizationPolicy: (job, principal) =>
    job.submitterPrincipal === principal,
});
```

Override to implement role-based or shared-tenant access.

## Sessions, resume, and auth

Resume must come from the same principal. The runtime verifies the
bearer token on resume identically to the initial handshake, then
rejects if `principal` doesn't match the session owner. See
[resume.md](./resume.md).

## DNS-rebind protection

When you host the WS upgrade on a public HTTP server, validate `Host`
to prevent DNS-rebind attacks. The `@arcp/express` helper does this
for you (`allowedHosts`). For other hosts:

```ts
import { attachArcpUpgrade } from "@arcp/node";

attachArcpUpgrade(httpServer, {
  allowedHosts: ["api.example.com"],
  onTransport: (t) => server.accept(t),
});
```

## Vendor auth extensions

ARCP v1.0 reserves `authScheme: "bearer"` as the only standard value.
Custom schemes go through the `x-vendor.*` namespace:

```ts
// hypothetical mTLS extension
const client = new ARCPClient({
  // …
  authScheme: "x-vendor.acme.mtls" as any,
  extensions: {
    "x-vendor.acme.mtls": { cert: pem },
  },
});
```

The runtime side must register a verifier that recognizes the scheme.
See [vendor-extensions.md](./vendor-extensions.md).

## Runnable example

[`examples/custom-auth/`](../../examples/custom-auth/) — a verifier
that calls out to a mock JWKS-style introspection endpoint.
