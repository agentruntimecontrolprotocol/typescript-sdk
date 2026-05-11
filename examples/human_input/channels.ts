/**
 * Per-destination channel adapters. Real versions wrap ntfy.sh, SES,
 * and the Slack web API. Each returns a value matching the request's
 * `response_schema`.
 */

export type ChannelResponse = (
  prompt: string,
  schema: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const ntfyPhone: ChannelResponse = async () => {
  throw new Error("not implemented");
};

const emailOncall: ChannelResponse = async () => {
  throw new Error("not implemented");
};

const slackOps: ChannelResponse = async () => {
  throw new Error("not implemented");
};

export const REGISTRY: Record<string, ChannelResponse> = {
  "ntfy:phone": ntfyPhone,
  "email:oncall": emailOncall,
  "slack:ops": slackOps,
};
