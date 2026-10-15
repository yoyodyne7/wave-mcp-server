import { describe, expect, it } from "vitest";
import { approveInvoice, markInvoiceSent, sendInvoice } from "../src/tools/invoice-actions.js";
import { rawInvoice } from "./fixtures.js";
import { fakeClient, type FakeClient } from "./helpers.js";

const business = (emailSendEnabled = true) => ({
  business: { id: "BIZ", name: "Acme Inc.", isPersonal: false, timezone: null, emailSendEnabled, currency: { code: "CAD" } },
});

/** Route fake queries by document so tests do not depend on call order. */
function route(client: FakeClient, invoice: unknown, biz = business()) {
  client.query.mockImplementation(async (doc: string) =>
    doc.includes("GetInvoice") ? { business: { invoice } } : biz,
  );
}

const sendArgs = { invoice_id: "INV1", to: ["ana@acme.test"], subject: "Invoice 42", attach_pdf: true, cc_myself: false };

describe("wave_approve_invoice", () => {
  it("previews without mutating", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    const result = await approveInvoice(client, { invoice_id: "INV1" });
    expect(result.data.status).toBe("preview");
    expect(result.data.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(result.data.preview).toMatchObject({ customer: "Acme Paints", total: "1130.00", tax_total: "130.00", currency: "CAD" });
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("approves on confirm with the preview fingerprint", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    const preview = await approveInvoice(client, { invoice_id: "INV1" });
    client.mutate.mockResolvedValue({ invoiceApprove: { didSucceed: true, inputErrors: [] } });
    const result = await approveInvoice(client, { invoice_id: "INV1", confirm: true, fingerprint: preview.data.fingerprint as string });
    expect(client.mutate).toHaveBeenCalledTimes(1);
    expect(client.mutate.mock.calls[0][1]).toEqual({ invoiceId: "INV1" });
    expect(result.data.status).toBe("done");
    expect(result.data.invoice).toMatchObject({ id: "INV1" });
  });

  it("refuses to proceed when the invoice changed after the preview", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    const preview = await approveInvoice(client, { invoice_id: "INV1" });
    route(client, rawInvoice({ status: "DRAFT", modifiedAt: "2026-10-08T13:00:00Z", total: { value: "2,260.00", currency: { code: "CAD" } } }));
    const result = await approveInvoice(client, { invoice_id: "INV1", confirm: true, fingerprint: preview.data.fingerprint as string });
    expect(result.data.status).toBe("preview");
    expect(result.data.message).toMatch(/changed/i);
    expect(result.data.fingerprint).not.toBe(preview.data.fingerprint);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("rejects confirm without a fingerprint", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    await expect(approveInvoice(client, { invoice_id: "INV1", confirm: true })).rejects.toThrow(/preview/i);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("refuses an invoice that is not a draft", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "SENT" }));
    await expect(approveInvoice(client, { invoice_id: "INV1" })).rejects.toThrow(/already/i);
  });

  it("refuses an invoice outside the pinned business with no mutation", async () => {
    const client = fakeClient();
    route(client, null);
    await expect(approveInvoice(client, { invoice_id: "OTHER", confirm: true, fingerprint: "0123456789abcdef" })).rejects.toThrow(/No invoice/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("reports success when the action went through but the re-read fails", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    const preview = await approveInvoice(client, { invoice_id: "INV1" });
    client.mutate.mockImplementation(async () => {
      client.query.mockRejectedValue(new Error("Could not reach Wave"));
      return { invoiceApprove: { didSucceed: true, inputErrors: [] } };
    });
    const result = await approveInvoice(client, { invoice_id: "INV1", confirm: true, fingerprint: preview.data.fingerprint as string });
    expect(result.data.status).toBe("done");
    expect(result.data.message).toMatch(/succeeded/i);
    expect(result.data.message).toMatch(/do not repeat/i);
    expect(result.data.invoice).toBeUndefined();
  });

  it("surfaces a Wave refusal", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    const preview = await approveInvoice(client, { invoice_id: "INV1" });
    client.mutate.mockResolvedValue({ invoiceApprove: { didSucceed: false, inputErrors: [{ path: ["input"], message: "Cannot approve." }] } });
    await expect(approveInvoice(client, { invoice_id: "INV1", confirm: true, fingerprint: preview.data.fingerprint as string })).rejects.toThrow(/Cannot approve\./);
  });
});

describe("wave_send_invoice", () => {
  it("previews recipients, subject and totals", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const result = await sendInvoice(client, sendArgs);
    expect(result.data.preview).toMatchObject({
      to: ["ana@acme.test"], subject: "Invoice 42", attach_pdf: true, customer: "Acme Paints",
      customer_email: "ana@acme.test", recipient_matches_customer: true, total: "1130.00", tax_total: "130.00",
    });
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("flags a recipient that is not the customer's email", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const result = await sendInvoice(client, { ...sendArgs, to: ["someone@else.test"] });
    expect(result.data.preview).toMatchObject({ recipient_matches_customer: false });
    expect(result.text).toMatch(/not the customer's email/i);
  });

  it("matches the customer's email case-insensitively", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const result = await sendInvoice(client, { ...sendArgs, to: ["ANA@Acme.test"] });
    expect(result.data.preview).toMatchObject({ recipient_matches_customer: true });
  });

  it("sends on confirm", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const preview = await sendInvoice(client, sendArgs);
    client.mutate.mockResolvedValue({ invoiceSend: { didSucceed: true, inputErrors: [] } });
    const result = await sendInvoice(client, { ...sendArgs, confirm: true, fingerprint: preview.data.fingerprint as string });
    expect(client.mutate.mock.calls[0][1]).toEqual({
      invoiceId: "INV1", to: ["ana@acme.test"], subject: "Invoice 42", attachPDF: true, ccMyself: false,
    });
    expect(result.data.status).toBe("done");
  });

  it("treats changed recipients as a new preview, not a send", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const preview = await sendInvoice(client, sendArgs);
    const result = await sendInvoice(client, { ...sendArgs, to: ["other@acme.test"], confirm: true, fingerprint: preview.data.fingerprint as string });
    expect(result.data.status).toBe("preview");
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("refuses a draft and points to approval", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    await expect(sendInvoice(client, sendArgs)).rejects.toThrow(/wave_approve_invoice/);
  });

  it("explains when Wave email sending is disabled", async () => {
    const client = fakeClient();
    route(client, rawInvoice(), business(false));
    await expect(sendInvoice(client, sendArgs)).rejects.toThrow(/wave_mark_invoice_sent/);
    expect(client.mutate).not.toHaveBeenCalled();
  });
});

describe("wave_mark_invoice_sent", () => {
  it("previews then marks sent with the chosen method", async () => {
    const client = fakeClient();
    route(client, rawInvoice());
    const args = { invoice_id: "INV1", send_method: "GMAIL" as const };
    const preview = await markInvoiceSent(client, args);
    expect(preview.data.status).toBe("preview");
    client.mutate.mockResolvedValue({ invoiceMarkSent: { didSucceed: true, inputErrors: [] } });
    await markInvoiceSent(client, { ...args, confirm: true, fingerprint: preview.data.fingerprint as string });
    expect(client.mutate.mock.calls[0][1]).toEqual({ invoiceId: "INV1", sendMethod: "GMAIL" });
  });

  it("refuses a draft", async () => {
    const client = fakeClient();
    route(client, rawInvoice({ status: "DRAFT" }));
    await expect(markInvoiceSent(client, { invoice_id: "INV1", send_method: "MARKED_SENT" })).rejects.toThrow(/wave_approve_invoice/);
  });
});
