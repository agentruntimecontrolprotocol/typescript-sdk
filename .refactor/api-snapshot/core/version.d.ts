/**
 * Protocol version implemented by this package.
 *
 * Tracks ARCP v1.1 (additive over v1.0). The `arcp` envelope field is the
 * literal major-version string per §5.1; v1.1 keeps this at `"1"` and uses
 * the feature-negotiation capability in `session.hello`/`session.welcome`
 * to detect what each peer supports.
 */
export declare const PROTOCOL_VERSION: "1";
/** Implementation version of this package. Bump on releases. */
export declare const IMPL_VERSION: "0.2.0";
/**
 * v1.1 feature flag names advertised in
 * `session.hello.payload.capabilities.features` and
 * `session.welcome.payload.capabilities.features`.
 *
 * The effective feature set is the intersection of the two lists (§6.2).
 * Neither peer may use a feature outside that intersection.
 */
export declare const V1_1_FEATURES: readonly ["heartbeat", "ack", "list_jobs", "subscribe", "lease_expires_at", "cost.budget", "progress", "result_chunk", "agent_versions"];
/** Union of canonical v1.1 feature flag names. */
export type V1_1_Feature = (typeof V1_1_FEATURES)[number];
/**
 * Template-literal type that pins the envelope `arcp` field to the literal
 * `PROTOCOL_VERSION`. Useful for asserting an outbound envelope is
 * wire-compatible at compile time.
 */
export type ProtocolVersion = typeof PROTOCOL_VERSION;
/**
 * Whether `other` is wire-compatible with this implementation.
 *
 * v1.1 stays at `arcp: "1"` literally — the wire-format major did not
 * change between v1.0 and v1.1. Feature negotiation happens through the
 * `capabilities.features` array.
 */
export declare function isCompatibleVersion(other: string): boolean;
/**
 * Compute the negotiated feature intersection between two peers'
 * advertised feature lists. Either may be undefined (v1.0 peer).
 */
export declare function intersectFeatures(a: readonly string[] | undefined, b: readonly string[] | undefined): string[];
//# sourceMappingURL=version.d.ts.map