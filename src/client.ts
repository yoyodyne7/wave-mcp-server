import type { Config } from "./config.js";
import { WaveError, fromGraphQLErrors, unknownOutcome, type GraphQLErrorItem } from "./errors.js";

export const WAVE_ENDPOINT = "https://gql.waveapps.com/graphql/public";

const RETRY_DELAYS_MS = [500, 1500, 4000];
const DEFAULT_TIMEOUT_MS = 30_000;

export interface WaveClient {
  readonly businessId: string;
  query<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
  mutate<T>(document: string, input: Record<string, unknown>): Promise<T>;
}

export interface ClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

interface GraphQLBody<T> {
  data?: T | null;
  errors?: GraphQLErrorItem[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 429 || status >= 500;

/** Describe a thrown error. fetch can echo the Authorization header, so strip the token. */
function reason(e: unknown, token: string): string {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return text.split(token).join("[redacted]");
}

function post(
  token: string,
  options: ClientOptions,
  document: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchImpl(WAVE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

async function parse<T>(res: Response): Promise<T> {
  let body: GraphQLBody<T>;
  try {
    body = (await res.json()) as GraphQLBody<T>;
  } catch {
    throw new WaveError("BAD_RESPONSE", `Wave returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (body.errors?.length) throw fromGraphQLErrors(body.errors);
  if (!res.ok) throw new WaveError(`HTTP_${res.status}`, `Wave returned HTTP ${res.status}.`);
  if (body.data == null) throw new WaveError("BAD_RESPONSE", "Wave returned no data.");
  return body.data;
}

async function read<T>(
  token: string,
  options: ClientOptions,
  document: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < RETRY_DELAYS_MS.length;
    let res: Response;
    try {
      res = await post(token, options, document, variables);
    } catch (e) {
      if (canRetry) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new WaveError("NETWORK", `Could not reach Wave after ${attempt + 1} attempts (${reason(e, token)}).`);
    }
    if (retryable(res.status) && canRetry) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    return parse<T>(res);
  }
}

export function createClient(config: Config, options: ClientOptions = {}): WaveClient {
  return {
    businessId: config.businessId,
    query<T>(document: string, variables: Record<string, unknown> = {}) {
      return read<T>(config.token, options, document, { ...variables, businessId: config.businessId });
    },
    async mutate<T>(document: string, input: Record<string, unknown>) {
      let res: Response;
      try {
        res = await post(config.token, options, document, { input });
      } catch (e) {
        throw unknownOutcome(reason(e, config.token));
      }
      if (retryable(res.status)) throw unknownOutcome(`HTTP ${res.status}`);
      return parse<T>(res);
    },
  };
}

const LIST_BUSINESSES = `query ListBusinesses {
  businesses(page: 1, pageSize: 50) { edges { node { id name isPersonal } } }
}`;

export async function listBusinesses(
  token: string,
  options: ClientOptions = {},
): Promise<{ id: string; name: string; isPersonal: boolean }[]> {
  const data = await read<{
    businesses: { edges: { node: { id: string; name: string; isPersonal: boolean } }[] };
  }>(token, options, LIST_BUSINESSES, {});
  return data.businesses.edges.map((edge) => edge.node);
}
