import { describe, expect, it } from "vitest";
import {
  WaveError,
  assertSucceeded,
  fromGraphQLErrors,
  notFound,
  requireBusiness,
  toToolError,
  unknownOutcome,
} from "../src/errors.js";

describe("fromGraphQLErrors", () => {
  it("explains an expired token and how to replace it", () => {
    const e = fromGraphQLErrors([
      { message: "Login required.", extensions: { code: "UNAUTHENTICATED", id: "req-1" } },
    ]);
    expect(e.code).toBe("UNAUTHENTICATED");
    expect(e.message).toMatch(/Manage Applications/);
    expect(e.message).toMatch(/WAVE_ACCESS_TOKEN/);
    expect(e.message).toContain("req-1");
  });

  it("points NOT_FOUND at the list tools", () => {
    const e = fromGraphQLErrors([
      { message: "Invoice 'X' could not be found.", extensions: { code: "NOT_FOUND" } },
    ]);
    expect(e.message).toContain("Invoice 'X' could not be found.");
    expect(e.message).toMatch(/wave_list_/);
  });

  it("flags a possible schema change on validation failure", () => {
    const e = fromGraphQLErrors([
      { message: 'Cannot query field "foo".', extensions: { code: "GRAPHQL_VALIDATION_FAILED" } },
    ]);
    expect(e.message).toMatch(/schema may have changed/);
  });

  it("falls back to the raw message for unknown codes", () => {
    const e = fromGraphQLErrors([{ message: "Boom" }]);
    expect(e.code).toBe("GRAPHQL_ERROR");
    expect(e.message).toContain("Boom");
  });
});

describe("assertSucceeded", () => {
  it("passes when didSucceed is true", () => {
    expect(() => assertSucceeded("create the invoice", { didSucceed: true })).not.toThrow();
  });

  it("lists input errors field by field", () => {
    expect(() =>
      assertSucceeded("create the invoice", {
        didSucceed: false,
        inputErrors: [
          { path: ["input", "customerId"], message: "Customer not found." },
          { path: null, code: "INVALID" },
        ],
      }),
    ).toThrow(/create the invoice[\s\S]*input\.customerId: Customer not found\.[\s\S]*\(input\): INVALID/);
  });

  it("handles a failure with no reason and a null payload", () => {
    expect(() => assertSucceeded("send the invoice", { didSucceed: false })).toThrow(/gave no reason/);
    expect(() => assertSucceeded("send the invoice", null)).toThrow(WaveError);
  });
});

describe("helpers", () => {
  it("notFound names the id and the list tool", () => {
    const e = notFound("invoice", "INV1", "wave_list_invoices");
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toContain("INV1");
    expect(e.message).toContain("wave_list_invoices");
    expect(e.message).toMatch(/configured business/);
  });

  it("requireBusiness rejects null", () => {
    expect(requireBusiness({ id: "b" })).toEqual({ id: "b" });
    expect(() => requireBusiness(null)).toThrow(/WAVE_BUSINESS_ID/);
  });

  it("unknownOutcome says the write was not retried", () => {
    const e = unknownOutcome("HTTP 503");
    expect(e.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(e.message).toMatch(/not retried/);
    expect(e.message).toMatch(/wave_get_invoice/);
  });

  it("toToolError returns an isError result", () => {
    expect(toToolError(new WaveError("X", "nope"))).toEqual({
      isError: true,
      content: [{ type: "text", text: "nope" }],
    });
    expect(toToolError("plain").content[0].text).toBe("plain");
  });
});
