import { describe, expect, it } from "vitest";
import { createInvoice, fetchInvoice, getInvoice, listInvoices, snapshotOf, updateInvoice } from "../src/tools/invoices.js";
import { rawCustomer, rawInvoice } from "./fixtures.js";
import { fakeClient } from "./helpers.js";

describe("wave_list_invoices", () => {
  it("maps filters to Wave arguments and flattens summaries", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({
      business: { invoices: { pageInfo: { currentPage: 1, totalPages: 2, totalCount: 30 }, edges: [{ node: rawInvoice() }] } },
    });
    const result = await listInvoices(client, {
      status: "OVERDUE", customer_id: "C1", invoice_date_start: "2026-09-01", invoice_date_end: "2026-09-30", page: 1, page_size: 25,
    });
    expect(client.query.mock.calls[0][1]).toEqual({
      page: 1, pageSize: 25, status: "OVERDUE", customerId: "C1", currency: undefined,
      invoiceDateStart: "2026-09-01", invoiceDateEnd: "2026-09-30", invoiceNumber: undefined,
    });
    expect(result.data).toMatchObject({ total_count: 30, has_more: true });
    expect((result.data.items as unknown[])[0]).toEqual({
      id: "INV1", invoice_number: "42", status: "SAVED", invoice_date: "2026-10-01", due_date: "2026-10-31",
      customer_id: "C1", customer_name: "Acme Paints", currency: "CAD", total: "1130.00", amount_due: "1130.00",
      modified_at: "2026-10-08T12:00:00Z",
    });
  });
});

describe("wave_get_invoice", () => {
  it("returns line items, taxes and links", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { invoice: rawInvoice() } });
    const { data } = await getInvoice(client, { invoice_id: "INV1" });
    expect(data).toMatchObject({
      id: "INV1", customer_email: "ana@acme.test", tax_total: "130.00", amount_paid: "0.00", exchange_rate: "1",
      pdf_url: "https://wave.test/inv1.pdf", view_url: "https://wave.test/inv1", payments: [],
    });
    expect((data.items as unknown[])[0]).toEqual({
      product_id: "P1", product_name: "Content retainer", description: "October retainer", quantity: "1",
      unit_price: "1000", subtotal: "1000.00", total: "1130.00",
      taxes: [{ sales_tax_id: "T1", abbreviation: "HST", rate: "0.13", amount: "130.00" }],
    });
  });

  it("refuses an invoice outside the pinned business", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { invoice: null } });
    await expect(fetchInvoice(client, "OTHER")).rejects.toThrow(/wave_list_invoices/);
  });

  it("tolerates null payments and items", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { invoice: rawInvoice({ payments: null, items: null }) } });
    const { data } = await getInvoice(client, { invoice_id: "INV1" });
    expect(data).toMatchObject({ payments: [], items: [] });
  });
});

describe("snapshotOf", () => {
  it("captures the fields the confirm gate fingerprints", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { invoice: rawInvoice() } });
    expect(snapshotOf(await fetchInvoice(client, "INV1"))).toEqual({
      id: "INV1", status: "SAVED", total: "1130.00", amountDue: "1130.00", modifiedAt: "2026-10-08T12:00:00Z",
    });
  });
});

describe("wave_create_invoice", () => {
  const ok = { invoiceCreate: { didSucceed: true, inputErrors: [], invoice: rawInvoice({ status: "DRAFT" }) } };

  const withCustomer = () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { customer: rawCustomer() } });
    return client;
  };

  it("refuses a customer outside the pinned business and issues no mutation", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { customer: null } });
    await expect(createInvoice(client, { customer_id: "OTHER", items: [{ product_id: "P1" }] })).rejects.toThrow(/No customer/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("always creates a draft in the pinned business", async () => {
    const client = withCustomer();
    client.mutate.mockResolvedValue(ok);
    const result = await createInvoice(client, {
      customer_id: "C1", invoice_date: "2026-10-01", due_date: "2026-10-31", currency: "CAD", memo: "Thanks",
      items: [{ product_id: "P1", description: "October retainer", quantity: "1", unit_price: "1000.00", sales_tax_ids: ["T1"] }],
    });
    expect(client.mutate.mock.calls[0][1]).toEqual({
      businessId: "BIZ", customerId: "C1", status: "DRAFT", invoiceDate: "2026-10-01", dueDate: "2026-10-31",
      currency: "CAD", memo: "Thanks",
      items: [{ productId: "P1", description: "October retainer", quantity: "1", unitPrice: "1000.00", taxes: [{ salesTaxId: "T1" }] }],
    });
    expect(result.data.status).toBe("DRAFT");
  });

  it("keeps an empty tax list so a zero-rated line is not given the product's default tax", async () => {
    const client = withCustomer();
    client.mutate.mockResolvedValue(ok);
    await createInvoice(client, { customer_id: "C1", items: [{ product_id: "P1", sales_tax_ids: [] }] });
    expect(client.mutate.mock.calls[0][1].items[0]).toEqual({ productId: "P1", taxes: [] });
  });

  it("omits taxes when not specified so Wave applies the product defaults", async () => {
    const client = withCustomer();
    client.mutate.mockResolvedValue(ok);
    await createInvoice(client, { customer_id: "C1", items: [{ product_id: "P1" }] });
    expect(client.mutate.mock.calls[0][1].items[0]).toEqual({ productId: "P1" });
  });

  it("surfaces Wave input errors", async () => {
    const client = withCustomer();
    client.mutate.mockResolvedValue({
      invoiceCreate: { didSucceed: false, inputErrors: [{ path: ["input", "customerId"], message: "Customer not found." }], invoice: null },
    });
    await expect(createInvoice(client, { customer_id: "BAD", items: [{ product_id: "P1" }] })).rejects.toThrow(/customerId: Customer not found\./);
  });
});

describe("wave_update_invoice", () => {
  it("refuses a non-draft and issues no mutation", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { invoice: rawInvoice({ status: "SENT" }) } });
    await expect(updateInvoice(client, { invoice_id: "INV1", memo: "x" })).rejects.toThrow(/SENT/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("patches a draft without ever sending status", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { invoice: rawInvoice({ status: "DRAFT" }) } });
    client.mutate.mockResolvedValue({ invoicePatch: { didSucceed: true, inputErrors: [], invoice: rawInvoice({ status: "DRAFT", memo: "New" }) } });
    const result = await updateInvoice(client, { invoice_id: "INV1", memo: "New", due_date: "2026-11-15" });
    expect(client.mutate.mock.calls[0][1]).toEqual({ id: "INV1", memo: "New", dueDate: "2026-11-15" });
    expect(result.data.memo).toBe("New");
  });

  it("refuses to move a draft to a customer outside the pinned business", async () => {
    const client = fakeClient();
    client.query.mockImplementation(async (doc: string) =>
      doc.includes("GetInvoice") ? { business: { invoice: rawInvoice({ status: "DRAFT" }) } } : { business: { customer: null } },
    );
    await expect(updateInvoice(client, { invoice_id: "INV1", customer_id: "OTHER" })).rejects.toThrow(/No customer/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("refuses an update with no fields", async () => {
    const client = fakeClient();
    await expect(updateInvoice(client, { invoice_id: "INV1" })).rejects.toThrow(/at least one field/);
  });
});
