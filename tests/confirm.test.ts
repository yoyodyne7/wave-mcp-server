import { describe, expect, it } from "vitest";
import { checkGate, fingerprint } from "../src/confirm.js";

const snapshot = { id: "INV1", status: "SAVED", total: "1130.00", amountDue: "1130.00", modifiedAt: "2026-10-08T12:00:00Z" };
const inputs = { to: ["a@example.com"], subject: "Invoice" };

describe("fingerprint", () => {
  it("is stable regardless of input key order", () => {
    expect(fingerprint("wave_send_invoice", snapshot, { a: 1, b: { d: 2, c: 3 } })).toBe(
      fingerprint("wave_send_invoice", snapshot, { b: { c: 3, d: 2 }, a: 1 }),
    );
  });

  it("changes with the tool, the invoice state, or the inputs", () => {
    const base = fingerprint("wave_send_invoice", snapshot, inputs);
    expect(fingerprint("wave_approve_invoice", snapshot, inputs)).not.toBe(base);
    expect(fingerprint("wave_send_invoice", { ...snapshot, modifiedAt: "2026-10-08T12:00:01Z" }, inputs)).not.toBe(base);
    expect(fingerprint("wave_send_invoice", { ...snapshot, amountDue: "0.00" }, inputs)).not.toBe(base);
    expect(fingerprint("wave_send_invoice", snapshot, { ...inputs, to: ["b@example.com"] })).not.toBe(base);
  });
});

describe("checkGate", () => {
  const fp = fingerprint("wave_send_invoice", snapshot, inputs);

  it("returns a preview when confirm is absent or false", () => {
    expect(checkGate({ tool: "wave_send_invoice", snapshot, inputs })).toEqual({ proceed: false, reason: "preview", fingerprint: fp });
    expect(checkGate({ tool: "wave_send_invoice", snapshot, inputs, confirm: false, fingerprint: fp })).toEqual({
      proceed: false, reason: "preview", fingerprint: fp,
    });
  });

  it("proceeds on a matching fingerprint", () => {
    expect(checkGate({ tool: "wave_send_invoice", snapshot, inputs, confirm: true, fingerprint: fp })).toEqual({ proceed: true });
  });

  it("reports a mismatch with the fresh fingerprint", () => {
    const changed = { ...snapshot, status: "PAID" };
    expect(checkGate({ tool: "wave_send_invoice", snapshot: changed, inputs, confirm: true, fingerprint: fp })).toEqual({
      proceed: false, reason: "mismatch", fingerprint: fingerprint("wave_send_invoice", changed, inputs),
    });
  });

  it("rejects confirm without a fingerprint", () => {
    expect(() => checkGate({ tool: "wave_send_invoice", snapshot, inputs, confirm: true })).toThrow(/preview/i);
  });
});
