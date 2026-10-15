import { describe, expect, it } from "vitest";
import { z } from "zod";
import { currencyCode, decimal, isoDate, paging, positiveDecimal } from "../src/schemas.js";

describe("schemas", () => {
  it("isoDate rejects impossible dates", () => {
    expect(isoDate.safeParse("2026-10-08").success).toBe(true);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("Oct 8").success).toBe(false);
  });

  it("decimal accepts plain strings only", () => {
    expect(decimal.safeParse("1500.50").success).toBe(true);
    expect(decimal.safeParse("0").success).toBe(true);
    for (const bad of ["1,500", "$1500", "-5", "1e3", ""]) {
      expect(decimal.safeParse(bad).success).toBe(false);
    }
  });

  it("positiveDecimal rejects zero", () => {
    expect(positiveDecimal.safeParse("0.00").success).toBe(false);
    expect(positiveDecimal.safeParse("0.01").success).toBe(true);
  });

  it("currencyCode wants three capitals", () => {
    expect(currencyCode.safeParse("CAD").success).toBe(true);
    expect(currencyCode.safeParse("cad").success).toBe(false);
  });

  it("paging defaults and caps", () => {
    const schema = z.object(paging);
    expect(schema.parse({})).toEqual({ page: 1, page_size: 25 });
    expect(schema.safeParse({ page_size: 101 }).success).toBe(false);
    expect(schema.safeParse({ page: 0 }).success).toBe(false);
  });
});
