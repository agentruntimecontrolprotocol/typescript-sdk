/**
 * Options for `createArcpHonoApp`.
 */
export interface CreateArcpHonoAppOptions {
  /**
   * If set, every HTTP request is rejected with 403 unless its `Host` header
   * (without port) matches an entry. Mirrors the WebSocket-side check in
   * `attachArcpToHono` and protects against DNS rebinding.
   */
  allowedHosts?: readonly string[];
}
