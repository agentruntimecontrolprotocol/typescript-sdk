import type {
  HumanChoiceRequestPayload,
  HumanChoiceResponsePayload,
  HumanInputRequestPayload,
  HumanInputResponsePayload,
  PermissionDenyPayload,
  PermissionGrantPayload,
  PermissionRequestPayload,
} from "../messages/index.js";

/**
 * Pluggable human-input handler. Implementations satisfy the prompt by
 * surfacing the request to the operator (terminal, ntfy, Slack, etc.) and
 * returning a typed response.
 */
export interface HumanInputHandler {
  onInputRequest(payload: HumanInputRequestPayload): Promise<HumanInputResponsePayload>;
  onChoiceRequest(payload: HumanChoiceRequestPayload): Promise<HumanChoiceResponsePayload>;
}

/** Pluggable permission-decision handler (§15.4). */
export interface PermissionDecisionHandler {
  decide(
    payload: PermissionRequestPayload,
  ): Promise<
    { kind: "grant"; grant: PermissionGrantPayload } | { kind: "deny"; deny: PermissionDenyPayload }
  >;
}

/**
 * A reference handler that always denies, useful as a safe default and in
 * tests that want to assert deny pathways.
 */
export class DenyAllPermissionHandler implements PermissionDecisionHandler {
  public async decide(
    payload: PermissionRequestPayload,
  ): Promise<{ kind: "deny"; deny: PermissionDenyPayload }> {
    return {
      kind: "deny",
      deny: {
        permission: payload.permission,
        resource: payload.resource,
        operation: payload.operation,
        reason: "DenyAllPermissionHandler default",
      },
    };
  }
}
