import { z } from "zod";
import { isRealDate, toScaled } from "./format.js";

export const id = (what: string) =>
  z.string().min(1).describe(`${what} ID exactly as returned by Wave (an opaque string)`);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isRealDate, "Not a real calendar date");

export const decimal = z
  .string()
  .regex(
    /^\d+(\.\d{1,5})?$/,
    'Use a plain decimal string such as "1500" or "1500.50" (no currency symbol, no commas)',
  );

export const positiveDecimal = decimal.refine((v) => toScaled(v) > 0n, "Must be greater than zero");

export const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code such as "CAD" or "USD"');

export const paging = {
  page: z.number().int().min(1).default(1).describe("1-based page number (default 1)"),
  page_size: z.number().int().min(1).max(100).default(25).describe("Items per page (default 25, max 100)"),
};

export const pageOutput = <T extends z.ZodTypeAny>(item: T) => ({
  items: z.array(item),
  page: z.number(),
  page_size: z.number(),
  total_count: z.number(),
  total_pages: z.number(),
  has_more: z.boolean(),
});
