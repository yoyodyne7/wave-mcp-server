import { describe, expect, it } from "vitest";
import { recordPayment } from "../src/tools/payments.js";
import { rawInvoice } from "./fixtures.js";
import { fakeClient, type FakeClient } from "./helpers.js";

const NOW = new Date("2026-10-08T15:00:00Z");
const account = { id: "A1", name: "Chequing", isArchived: false, currency: { code: "CAD" }, type: { name: "Assets", value: "ASSET" }, subtype: { name: "Cash & Bank", value: "CASH_AND_BANK" } };

function route(client: FakeClient, invoice: unknown, acct: unknown = account) {
  client.query.mockImplementation(async (doc: string) =>
    doc.includes("GetInvoice") ? { business: { invoice } } : { business: { account: acct } },
  );
}

const args = {
  invoice_id: "INV1", amount: "500.00", payment_date: "2026-10-08", payment_method: "BANK_TRANSFER" as const,
  payment_account_id: "A1", exchange_rate: "1",
};

describe("wave_record_payment", () => {
  it("previews amount, account and the resulting balance", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const result = await recordPayment(client, args, NOW);
    expect(result.data.status).toBe("preview");
    expect(result.data.preview).toMatchObject({
      invoice_number: "42", customer: "Acme Paints", amount: "500.00", currency: "CAD", payment_date: "2026-10-08",
      payment_method: "BANK_TRANSFER", deposit_account: "Chequing", amount_due_before: "1130.00", amount_due_after: "630.00",
    });
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("records the payment on confirm", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const preview = await recordPayment(client, args, NOW);
    client.mutate.mockResolvedValue({ invoicePaymentCreateManual: { didSucceed: true, inputErrors: [], invoicePayment: { id: "PAY1" } } });
    const result = await recordPayment(client, { ...args, memo: "e-transfer", confirm: false }, NOW);
    expect(result.data.fingerprint).not.toBe(preview.data.fingerprint);
    const done = await recordPayment(client, { ...args, confirm: true, fingerprint: preview.data.fingerprint as string }, NOW);
    expect(client.mutate).toHaveBeenCalledTimes(1);
    expect(client.mutate.mock.calls[0][1]).toEqual({
      invoiceId: "INV1", paymentAccountId: "A1", amount: "500.00", paymentDate: "2026-10-08",
      paymentMethod: "BANK_TRANSFER", exchangeRate: "1",
    });
    expect(done.data.status).toBe("done");
  });

  it("accepts a payment for exactly the amount due", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const result = await recordPayment(client, { ...args, amount: "1130" }, NOW);
    expect(result.data.preview).toMatchObject({ amount_due_after: "0.00" });
  });

  it("refuses an amount larger than the amount due", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    await expect(recordPayment(client, { ...args, amount: "11300" }, NOW)).rejects.toThrow(/more than the 1130\.00 CAD due/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("refuses a payment date in the future", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    await expect(recordPayment(client, { ...args, payment_date: "2026-11-08" }, NOW)).rejects.toThrow(/future/);
  });

  it("refuses a draft invoice", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    await expect(recordPayment(client, args, NOW)).rejects.toThrow(/wave_approve_invoice/);
  });

  it("refuses an invoice with nothing due", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "PAID", amountDue: { value: "0.00", currency: { code: "CAD" } } }));
    await expect(recordPayment(client, args, NOW)).rejects.toThrow(/nothing due/i);
  });

  it("refuses a deposit account outside the pinned business", async () => {
    const client = fakeClient();
    route(client, rawInvoice(), null);
    await expect(recordPayment(client, args, NOW)).rejects.toThrow(/wave_list_accounts/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  const usd = (value: string) => ({ value, currency: { code: "USD" } });
  const usdInvoice = () => rawInvoice({ currency: { code: "USD" }, total: usd("1,000.00"), amountDue: usd("1,000.00") });
  const { exchange_rate: _rate, ...noRate } = args;

  it("defaults the exchange rate to 1 when invoice and account share a currency", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const result = await recordPayment(client, noRate, NOW);
    expect(result.data.preview).toMatchObject({ exchange_rate: "1", currency_mismatch: false });
  });

  it("refuses a cross-currency payment with no explicit exchange rate", async () => {
    const client = fakeClient();
    route(client, usdInvoice());
    await expect(recordPayment(client, noRate, NOW)).rejects.toThrow(/USD[\s\S]*CAD[\s\S]*exchange_rate/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("previews a cross-currency payment when the rate is given", async () => {
    const client = fakeClient();
    route(client, usdInvoice());
    const result = await recordPayment(client, { ...noRate, exchange_rate: "1.37" }, NOW);
    expect(result.data.preview).toMatchObject({ exchange_rate: "1.37", currency_mismatch: true, currency: "USD", deposit_account_currency: "CAD" });
    expect(result.text).toMatch(/1\.37/);
  });

  it("surfaces a Wave refusal", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const preview = await recordPayment(client, args, NOW);
    client.mutate.mockResolvedValue({
      invoicePaymentCreateManual: { didSucceed: false, inputErrors: [{ path: ["input", "paymentAccountId"], message: "Invalid account." }], invoicePayment: null },
    });
    await expect(
      recordPayment(client, { ...args, confirm: true, fingerprint: preview.data.fingerprint as string }, NOW),
    ).rejects.toThrow(/paymentAccountId: Invalid account\./);
  });
});
