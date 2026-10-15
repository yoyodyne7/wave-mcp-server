export class WaveError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "WaveError";
  }
}

export interface GraphQLErrorItem {
  message: string;
  extensions?: { code?: string; id?: string };
}

export function fromGraphQLErrors(errors: GraphQLErrorItem[]): WaveError {
  const first = errors[0];
  const code = first.extensions?.code ?? "GRAPHQL_ERROR";
  const id = first.extensions?.id;
  let message: string;
  switch (code) {
    case "UNAUTHENTICATED":
      message =
        "Wave rejected the access token (expired or revoked). Create a new token under " +
        "Manage Applications in the Wave developer portal, update WAVE_ACCESS_TOKEN where you configured it, " +
        "then restart the server.";
      break;
    case "NOT_FOUND":
      message = `${first.message} Use the matching wave_list_* tool to find valid IDs.`;
      break;
    case "GRAPHQL_VALIDATION_FAILED":
      message =
        `Wave rejected the request shape: ${first.message} ` +
        "Wave's schema may have changed since this server was written.";
      break;
    default:
      message = `Wave error (${code}): ${first.message}`;
  }
  if (id) message += ` (Wave request id: ${id})`;
  return new WaveError(code, message, id);
}

export interface InputError {
  path?: string[] | null;
  message?: string | null;
  code?: string | null;
}

export interface MutationPayload {
  didSucceed: boolean;
  inputErrors?: InputError[] | null;
}

export function assertSucceeded(
  action: string,
  payload: MutationPayload | null | undefined,
): void {
  if (payload?.didSucceed) return;
  const lines = (payload?.inputErrors ?? []).map(
    (e) => `- ${(e.path ?? []).join(".") || "(input)"}: ${e.message ?? e.code ?? "invalid"}`,
  );
  throw new WaveError(
    "INPUT_ERROR",
    lines.length
      ? `Wave did not ${action}:\n${lines.join("\n")}`
      : `Wave did not ${action} and gave no reason. Check the current state with the matching wave_get_* tool.`,
  );
}

export function notFound(kind: string, id: string, listTool: string): WaveError {
  return new WaveError(
    "NOT_FOUND",
    `No ${kind} with id "${id}" exists in the configured business. Use ${listTool} to find valid IDs.`,
  );
}

export function requireBusiness<T>(business: T | null | undefined): T {
  if (business == null) {
    throw new WaveError(
      "BUSINESS_NOT_FOUND",
      "WAVE_BUSINESS_ID does not match a business this token can see. " +
        "Run `npx -y @sdnly/wave-mcp-server --list-businesses` and update WAVE_BUSINESS_ID.",
    );
  }
  return business;
}

export function unknownOutcome(why: string): WaveError {
  return new WaveError(
    "WRITE_OUTCOME_UNKNOWN",
    `The request to Wave failed (${why}) and was not retried, so it is unknown whether the change ` +
      "was applied. Check the current state with wave_get_invoice or the matching wave_list_* tool " +
      "before trying again.",
  );
}

export function toToolError(e: unknown): {
  isError: true;
  content: [{ type: "text"; text: string }];
} {
  const text = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text }] };
}
