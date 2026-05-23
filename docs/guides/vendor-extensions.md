# Vendor extensions (§15)

ARCP reserves the protocol surface (message types, event kinds,
capability namespaces) but provides a single, well-defined extension
namespace: `x-vendor.<vendor>.<rest>`. Anything in this namespace is
opaque to the runtime — round-tripped intact, ignored when not
understood, never silently dropped.

## What's extensible

| Surface                                   | Vendor namespace             |
| ----------------------------------------- | ---------------------------- |
| Envelope `type`                           | `x-vendor.<vendor>.<type>`   |
| Event `kind` (inside `job.event.payload`) | `x-vendor.<vendor>.<kind>`   |
| Lease capability namespace                | `x-vendor.<vendor>.<cap>`    |
| Envelope `extensions` object keys         | `x-vendor.<vendor>.<key>`    |

The `auth.scheme` field is pinned to the literal `"bearer"` in v1.1.
Out-of-band auth schemes (mTLS, signed proxy headers) terminate
upstream of the WS upgrade — see
[auth.md](./auth.md#vendor-auth-extensions).

## Naming rules

- Must start with `x-vendor.`.
- The vendor segment is a single dot-separated identifier (typically a
  reverse-DNS prefix or a short brand).
- Following segments name the specific extension.
- ASCII letters, digits, `-`, `.`; lower-case by convention.

Examples:

```
x-vendor.acme.cancel
x-vendor.com.example.confidence
x-vendor.opentelemetry.tracecontext
```

`validateExtensionsObject(obj)` and `isVendorExtensionName(s)` in
`@agentruntimecontrolprotocol/core` enforce these rules at runtime.

## Round-trip guarantee (§15)

The runtime and SDK MUST round-trip unknown `x-vendor.*` types and
keys without modification. The client receives them; if no handler is
registered, they're dropped on the floor at the receiver — but they
were not stripped on the way through.

This means a third-party tool can pass extension metadata through an
arbitrary ARCP runtime without the runtime understanding it.

## Custom event kinds

```ts
// Agent side
await ctx.emitEvent("x-vendor.acme.confidence", { score: 0.87 });

// Client side
client.on("job.event", (env) => {
  const e = env.payload;
  if (e.kind === "x-vendor.acme.confidence") {
    metrics.confidence.set(env.job_id!, e.body.score);
  }
});
```

`classifyUnknownType(type)` returns `"core" | "vendor-extension" |
"unknown"` for diagnostic logging.

## Custom envelope types

```ts
// Define a request/response pair
type AcmeWarmup = {
  type: "x-vendor.acme.warmup";
  payload: { model: string };
};

// Client sends — `client.send()` does NOT auto-fill session_id, so
// stamp it explicitly from the accepted state.
await client.send({
  arcp: "1.1",
  id: newMessageId(),
  type: "x-vendor.acme.warmup",
  session_id: client.state.id!,
  payload: { model: "gpt-4o-mini" },
});

// Runtime handler (registered on a SessionContext)
sessionCtx.registerHandler("x-vendor.acme.warmup", async (env) => {
  // `env.type` is the vendor type; cast `env.payload` to your local shape.
  const body = env.payload as { model: string };
  await warmup(body.model);
});
```

The runtime forwards types outside `CORE_MESSAGE_TYPES` to registered
handlers; if no handler matches and the type is `x-vendor.*`, the
envelope is dropped (silently round-tripped if it was being relayed).

## Custom lease capabilities

```ts
const lease = {
  "net.fetch": ["https://**"],
  "x-vendor.acme.kafka.publish": ["topic-orders-*", "topic-payments-*"],
};
```

The runtime's lease matcher treats unknown namespaces as opaque —
patterns are matched against whatever the application supplies as the
target. You're responsible for calling `validateLeaseOp` from inside
your custom tool wrappers if you want runtime enforcement.

## Envelope extensions

Every envelope carries an optional `extensions` object:

```ts
{
  arcp: "1.1",
  id: "01J...",
  type: "job.submit",
  payload: { /* ... */ },
  extensions: {
    "x-vendor.opentelemetry.tracecontext": {
      traceparent: "00-...",
      tracestate: "vendor=value",
    },
  },
}
```

This is how the OTel middleware propagates W3C trace context (see
[observability.md](./observability.md)).

Keys outside `x-vendor.*` in `extensions` are rejected on the wire —
`validateExtensionsObject()` throws `INVALID_REQUEST`. Future ARCP
revisions may add reserved keys to this object; vendors should never
poach unprefixed keys.

## Authoring discipline

A few rules of thumb when adding extensions:

- **Pick a vendor segment and stick with it.** Mixing
  `x-vendor.acme.*` and `x-vendor.com.acme.*` is forking your own
  namespace.
- **Document the shape.** Other implementers will round-trip your
  extension and may write their own consumers. Publish the schema.
- **Don't reach back into core.** An extension should not require
  patching the SDK to work — if it does, propose a spec change.
- **Mark experimental.** Use `x-vendor.<you>.experimental.*` for things
  you may change; promote out when stable.

## Discovery via `capabilities`

`CapabilitiesSchema` defines three reserved keys (`encodings`,
`agents`, `features`); any other top-level key is round-tripped as a
vendor advertisement. Use an `x-vendor.<you>.<name>` key on
`capabilities` to broadcast extension availability:

```ts
new ARCPServer({
  capabilities: {
    encodings: ["json"],
    agents: ["echo"],
    "x-vendor.acme.extensions": [
      "x-vendor.acme.warmup",
      "x-vendor.acme.confidence",
    ],
  },
});
```

The client can introspect `welcome.capabilities["x-vendor.acme.extensions"]`
to decide whether to send the corresponding envelopes. Standard v1.1
feature negotiation goes through `capabilities.features` and
`hasFeature(name)` — use that for non-vendor flags.

## Runnable example

[`examples/vendor-extensions/`](../../examples/vendor-extensions/) —
custom event kind, custom envelope type, and custom capability,
end-to-end.
