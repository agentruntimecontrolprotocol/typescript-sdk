/**
 * Options for `createArcpExpressApp`.
 */
export interface CreateArcpExpressAppOptions {
  /**
   * If set, every HTTP request is rejected with 403 unless its `Host` header
   * (without port) matches an entry. Mirrors the WebSocket-side check in
   * `attachArcpToExpress` and protects against DNS rebinding.
   */
  allowedHosts?: readonly string[];

  /**
   * Disable Express's `x-powered-by` header. Default: `true`.
   */
  disablePoweredBy?: boolean;
}
