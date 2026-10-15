import { describe, expect, it } from "vitest";
import { createProduct, fetchAccount, listAccounts, listProducts, listSalesTaxes } from "../src/tools/catalog.js";
import { fakeClient } from "./helpers.js";

const info = { currentPage: 1, totalPages: 1, totalCount: 1 };
const tax = { id: "T1", name: "HST", abbreviation: "HST", rate: "0.13", isCompound: false, isRecoverable: true };
const account = { id: "A1", name: "Chequing", isArchived: false, currency: { code: "CAD" }, type: { name: "Assets", value: "ASSET" }, subtype: { name: "Cash & Bank", value: "CASH_AND_BANK" } };
const product = { id: "P1", name: "Content retainer", description: null, unitPrice: 5000, isSold: true, isArchived: false, defaultSalesTaxes: [tax], incomeAccount: { id: "A9", name: "Sales" } };

describe("wave_list_products", () => {
  it("lists sold, unarchived products with prices as strings", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { products: { pageInfo: info, edges: [{ node: product }] } } });
    const result = await listProducts(client, { page: 1, page_size: 25 });
    expect(client.query.mock.calls[0][0]).toMatch(/isSold: true/);
    expect((result.data.items as unknown[])[0]).toEqual({
      id: "P1", name: "Content retainer", description: null, unit_price: "5000",
      income_account_id: "A9", income_account_name: "Sales",
      default_sales_taxes: [{ id: "T1", abbreviation: "HST", rate: "0.13" }],
    });
  });
});

describe("wave_list_sales_taxes", () => {
  it("maps rate and flags", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { salesTaxes: { pageInfo: info, edges: [{ node: tax }] } } });
    const result = await listSalesTaxes(client, { page: 1, page_size: 25 });
    expect((result.data.items as unknown[])[0]).toEqual({
      id: "T1", name: "HST", abbreviation: "HST", rate: "0.13", is_compound: false, is_recoverable: true,
    });
  });
});

describe("wave_list_accounts", () => {
  it("passes type and subtype filters and omits empty ones", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { accounts: { pageInfo: info, edges: [{ node: account }] } } });
    const result = await listAccounts(client, { subtypes: ["CASH_AND_BANK"], page: 1, page_size: 25 });
    expect(client.query.mock.calls[0][1]).toEqual({ page: 1, pageSize: 25, types: undefined, subtypes: ["CASH_AND_BANK"] });
    expect((result.data.items as unknown[])[0]).toEqual({
      id: "A1", name: "Chequing", currency: "CAD", type: "ASSET", subtype: "CASH_AND_BANK", is_archived: false,
    });
  });
});

describe("fetchAccount", () => {
  it("refuses an account outside the pinned business", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { account: null } });
    await expect(fetchAccount(client, "OTHER")).rejects.toThrow(/wave_list_accounts/);
  });
});

describe("wave_create_product", () => {
  it("sends the pinned business id and a decimal string price", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { account: { ...account, id: "A9", name: "Sales" } } });
    client.mutate.mockResolvedValue({ productCreate: { didSucceed: true, inputErrors: [], product } });
    const result = await createProduct(client, {
      name: "Content retainer", unit_price: "5000.00", income_account_id: "A9", default_sales_tax_ids: ["T1"],
    });
    expect(client.mutate.mock.calls[0][1]).toEqual({
      businessId: "BIZ", name: "Content retainer", unitPrice: "5000.00", incomeAccountId: "A9", defaultSalesTaxIds: ["T1"],
    });
    expect(result.data.id).toBe("P1");
  });

  it("refuses an income account outside the pinned business and issues no mutation", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { account: null } });
    await expect(createProduct(client, { name: "X", unit_price: "1", income_account_id: "OTHER" })).rejects.toThrow(/wave_list_accounts/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("surfaces Wave input errors", async () => {
    const client = fakeClient();
    client.mutate.mockResolvedValue({
      productCreate: { didSucceed: false, inputErrors: [{ path: ["input", "incomeAccountId"], message: "Wrong subtype." }], product: null },
    });
    await expect(createProduct(client, { name: "X", unit_price: "1" })).rejects.toThrow(/incomeAccountId: Wrong subtype\./);
  });
});
