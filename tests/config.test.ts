import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadToken, resolveEnv } from "../src/config.js";

describe("loadConfig", () => {
  it("returns trimmed values", () => {
    expect(loadConfig({ WAVE_ACCESS_TOKEN: "  tok  ", WAVE_BUSINESS_ID: " biz\n" })).toEqual({
      token: "tok",
      businessId: "biz",
    });
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/WAVE_ACCESS_TOKEN.*WAVE_BUSINESS_ID/s);
  });

  it("treats an empty or whitespace value as missing", () => {
    expect(() => loadConfig({ WAVE_ACCESS_TOKEN: "tok", WAVE_BUSINESS_ID: "   " })).toThrow(
      /WAVE_BUSINESS_ID/,
    );
  });

  it("tells the user how to find the business ID", () => {
    expect(() => loadConfig({ WAVE_ACCESS_TOKEN: "tok" })).toThrow(/--list-businesses/);
  });

  it("never echoes the token", () => {
    try {
      loadConfig({ WAVE_ACCESS_TOKEN: "secret-token-value" });
    } catch (e) {
      expect((e as Error).message).not.toContain("secret-token-value");
    }
  });
});

describe("loadToken", () => {
  it("needs only the token", () => {
    expect(loadToken({ WAVE_ACCESS_TOKEN: "tok" })).toBe("tok");
    expect(() => loadToken({})).toThrow(/WAVE_ACCESS_TOKEN/);
  });
});

describe("token shape", () => {
  it("rejects a token containing whitespace or control characters without echoing it", () => {
    for (const bad of ["abc\ndef", "abc def", "abc\tdef"]) {
      const err = (() => { try { loadConfig({ WAVE_ACCESS_TOKEN: bad, WAVE_BUSINESS_ID: "biz" }); } catch (e) { return e as Error; } })();
      expect(err).toBeInstanceOf(ConfigError);
      expect(err!.message).toMatch(/WAVE_ACCESS_TOKEN/);
      expect(err!.message).not.toContain("abc");
    }
  });
});

describe("resolveEnv", () => {
  it("uses the process environment when there is no .env file", () => {
    expect(resolveEnv({ WAVE_ACCESS_TOKEN: "t", WAVE_BUSINESS_ID: "b" }, undefined)).toMatchObject({ WAVE_ACCESS_TOKEN: "t", WAVE_BUSINESS_ID: "b" });
  });

  it("takes values from the .env file", () => {
    expect(resolveEnv({}, { WAVE_ACCESS_TOKEN: "t", WAVE_BUSINESS_ID: "b" })).toMatchObject({ WAVE_ACCESS_TOKEN: "t", WAVE_BUSINESS_ID: "b" });
  });

  it("accepts the same value in both places", () => {
    expect(resolveEnv({ WAVE_BUSINESS_ID: "b" }, { WAVE_BUSINESS_ID: " b " }).WAVE_BUSINESS_ID).toBe("b");
  });

  it("refuses to start when the shell and .env disagree, without echoing either value", () => {
    const err = (() => { try { resolveEnv({ WAVE_BUSINESS_ID: "shell-biz" }, { WAVE_BUSINESS_ID: "file-biz" }); } catch (e) { return e as Error; } })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.message).toMatch(/WAVE_BUSINESS_ID/);
    expect(err!.message).not.toMatch(/shell-biz|file-biz/);
  });
});
