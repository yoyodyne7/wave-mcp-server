import { describe, expect, it, vi } from "vitest";
import { WAVE_ENDPOINT, createClient, listBusinesses } from "../src/client.js";

const config = { token: "secret-token", businessId: "BIZ" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noSleep = () => Promise.resolve();

function setup(impl: (...args: unknown[]) => Promise<Response>) {
  const fetchImpl = vi.fn(impl) as unknown as typeof fetch;
  const sleep = vi.fn(noSleep);
  return { fetchImpl, sleep, client: createClient(config, { fetchImpl, sleep }) };
}

const bodyOf = (fetchImpl: typeof fetch, call = 0) =>
  JSON.parse((vi.mocked(fetchImpl).mock.calls[call][1] as RequestInit).body as string);

describe("query", () => {
  it("posts to Wave with the bearer token and the pinned business id", async () => {
    const { fetchImpl, client } = setup(async () => json({ data: { ok: 1 } }));
    await expect(client.query("query Q($businessId: ID!) { x }", { page: 2 })).resolves.toEqual({ ok: 1 });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe(WAVE_ENDPOINT);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret-token" });
    expect(bodyOf(fetchImpl).variables).toEqual({ page: 2, businessId: "BIZ" });
  });

  it("does not let a caller override the business id", async () => {
    const { fetchImpl, client } = setup(async () => json({ data: {} }));
    await client.query("q", { businessId: "OTHER" });
    expect(bodyOf(fetchImpl).variables.businessId).toBe("BIZ");
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    let n = 0;
    const { fetchImpl, sleep, client } = setup(async () =>
      ++n < 3 ? json({}, n === 1 ? 429 : 503) : json({ data: { ok: true } }),
    );
    await expect(client.query("q")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 retries", async () => {
    const { fetchImpl, client } = setup(async () => json({}, 503));
    await expect(client.query("q")).rejects.toMatchObject({ code: "HTTP_503" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("retries network failures and reports them without the token", async () => {
    const { fetchImpl, client } = setup(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await client.query("q").catch((e) => e);
    expect(err.code).toBe("NETWORK");
    expect(err.message).not.toContain("secret-token");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("maps GraphQL errors and does not retry them", async () => {
    const { fetchImpl, client } = setup(async () =>
      json({ data: { user: null }, errors: [{ message: "Login required.", extensions: { code: "UNAUTHENTICATED" } }] }),
    );
    await expect(client.query("q")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-JSON body", async () => {
    const { client } = setup(async () => new Response("<html>", { status: 200 }));
    await expect(client.query("q")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("mutate", () => {
  it("sends the input as the only variable", async () => {
    const { fetchImpl, client } = setup(async () => json({ data: { done: true } }));
    await client.mutate("mutation M($input: X!) { m(input: $input) { didSucceed } }", { a: 1 });
    expect(bodyOf(fetchImpl).variables).toEqual({ input: { a: 1 } });
  });

  it("never retries a 5xx and reports an unknown outcome", async () => {
    const { fetchImpl, sleep, client } = setup(async () => json({}, 502));
    await expect(client.mutate("m", {})).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never retries a network failure", async () => {
    const { fetchImpl, client } = setup(async () => {
      throw new Error("socket hang up");
    });
    await expect(client.mutate("m", {})).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("token redaction", () => {
  const leaky = async () => {
    throw new TypeError('Headers.append: "Bearer secret-token" is an invalid header value.');
  };

  it("keeps the token out of read errors", async () => {
    const { client } = setup(leaky);
    const err = await client.query("q").catch((e) => e);
    expect(err.message).not.toContain("secret-token");
    expect(err.message).toContain("[redacted]");
  });

  it("keeps the token out of write errors", async () => {
    const { client } = setup(leaky);
    const err = await client.mutate("m", {}).catch((e) => e);
    expect(err.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(err.message).not.toContain("secret-token");
  });
});

describe("listBusinesses", () => {
  it("returns id and name without needing a business id", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ data: { businesses: { edges: [{ node: { id: "B1", name: "Test", isPersonal: false } }] } } }),
    ) as unknown as typeof fetch;
    await expect(listBusinesses("tok", { fetchImpl })).resolves.toEqual([
      { id: "B1", name: "Test", isPersonal: false },
    ]);
    expect(bodyOf(fetchImpl).variables).toEqual({});
  });
});
