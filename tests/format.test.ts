import { describe, expect, it } from "vitest";
import {
  amount,
  compareDecimal,
  isRealDate,
  latestPaymentDate,
  pageEnvelope,
  subtractDecimal,
  toScaled,
} from "../src/format.js";

describe("pageEnvelope", () => {
  it("reports has_more from page counts", () => {
    expect(pageEnvelope(["a"], { currentPage: 1, totalPages: 3, totalCount: 51 }, 25)).toEqual({
      items: ["a"], page: 1, page_size: 25, total_count: 51, total_pages: 3, has_more: true,
    });
    expect(pageEnvelope([], { currentPage: 3, totalPages: 3, totalCount: 51 }, 25).has_more).toBe(false);
  });
});

describe("decimals", () => {
  it("strips thousands separators from Wave money values", () => {
    expect(amount({ value: "1,130.00", currency: { code: "CAD" } })).toBe("1130.00");
  });

  it("scales without floating point", () => {
    expect(toScaled("0.1") + toScaled("0.2")).toBe(toScaled("0.3"));
    expect(toScaled("1130")).toBe(113000000n);
  });

  it("rejects non-decimal input", () => {
    for (const bad of ["", "abc", "1,130.00", "1.123456", "$5"]) {
      expect(() => toScaled(bad)).toThrow();
    }
  });

  it("compares", () => {
    expect(compareDecimal("1130.00", "1130")).toBe(0);
    expect(compareDecimal("11300", "1130.00")).toBe(1);
    expect(compareDecimal("0.5", "0.50001")).toBe(-1);
  });

  it("subtracts and keeps two decimals", () => {
    expect(subtractDecimal("1130.00", "500")).toBe("630.00");
    expect(subtractDecimal("1130.00", "1130.00")).toBe("0.00");
    expect(subtractDecimal("10", "0.125")).toBe("9.875");
  });
});

describe("dates", () => {
  it("accepts only real calendar dates", () => {
    expect(isRealDate("2026-10-08")).toBe(true);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("10/08/2026")).toBe(false);
  });

  it("allows payment dates up to one day ahead of UTC now", () => {
    expect(latestPaymentDate(new Date("2026-10-08T23:30:00Z"))).toBe("2026-10-09");
  });
});
