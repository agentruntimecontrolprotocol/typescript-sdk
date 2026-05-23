# Authentication (§6.1)

ARCP v1.1 supports a single auth scheme: bearer tokens. The client
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
import { StaticBearerVerifier } from "@agentruntimecontrolprotocol/sdk";

const bearer = new StaticBearerVerifier(
  new Map([
    ["tok-alice", { principal: "alice@example.com" }],
    ["tok-bob",   { principal: "bob@example.com" }],
  ]),
);

const server = new ARCPServer({ /* ... */, bearer });
```

Each `BearerIdentity` carries:

```ts
type BearerIdentity = {
  principal: string;
  entitlements?: {
    sessions?: readonly string[]; // restrict resume to these session ids
    traces?: readonly string[]; // restrict trace_id visibility
  };
};
```

## Custom verifier

For real deployments, write your own verifier. The contract is one
async method:

```ts
import type { BearerVerifier, BearerIdentity } from "@agentruntimecontrolprotocol/core";

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
  // ...
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
  // The principal is not exposed on JobContext directly; it lives on
  // the runtime-side Job (`job.submitterPrincipal`). When you need it
  // inside an agent, capture it on submit and pass it through `input`,
  // or use a custom registration wrapper that closes over the
  // accepted identity.
  return { ok: true };
});
```

The `ARCPServerOptions.jobAuthorizationPolicy` lets you gate jobs on
principal — same-principal-only is the default:

```ts
new ARCPServer({
  // ...
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
to prevent DNS-rebind attacks. The `@agentruntimecontrolprotocol/express` helper does this
for you (`allowedHosts`). For other hosts:

```ts
import { attachArcpUpgrade } from "@agentruntimecontrolprotocol/node";

attachArcpUpgrade(httpServer, {
  allowedHosts: ["api.example.com"],
  onTransport: (t) => server.accept(t),
});
```

## Vendor auth extensions

The `auth.scheme` field on `session.hello` is pinned to the literal
`"bearer"` by `AuthSchemeSchema`, so vendor schemes cannot be smuggled
in there. Out-of-band credentials (mTLS, signed proxy headers, etc.)
travel on the transport layer — terminate them upstream of the WS
upgrade and inject the resulting bearer token (or a synthesized one)
on the `session.hello` envelope before the runtime sees it. Vendor
metadata about the auth method may be sent in `envelope.extensions`
under the `x-vendor.*` namespace; see
[vendor-extensions.md](./vendor-extensions.md).

## Runnable example

[`examples/custom-auth/`](../../examples/custom-auth/) — a verifier
that calls out to a mock JWKS-style introspection endpoint.
