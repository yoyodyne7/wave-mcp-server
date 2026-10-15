import { describe, expect, it } from "vitest";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "../src/tools/customers.js";
import { fakeClient } from "./helpers.js";

const raw = (over: Record<string, unknown> = {}) => ({
  id: "C1", name: "Acme Paints", firstName: "Ana", lastName: "Lee", email: "ana@acme.test", phone: null,
  isArchived: false, currency: { code: "CAD" },
  address: { addressLine1: "1 Main St", addressLine2: null, city: "Toronto", postalCode: "M1M 1M1", province: { code: "CA-ON", name: "Ontario" }, country: { code: "CA", name: "Canada" } },
  outstandingAmount: { value: "1,130.00", currency: { code: "CAD" } },
  overdueAmount: { value: "0.00", currency: { code: "CAD" } },
  ...over,
});
const page = (nodes: unknown[], currentPage = 1, totalPages = 1) => ({
  business: { customers: { pageInfo: { currentPage, totalPages, totalCount: nodes.length }, edges: nodes.map((node) => ({ node })) } },
});

describe("wave_list_customers", () => {
  it("returns a flattened page", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue(page([raw()]));
    const result = await listCustomers(client, { page: 1, page_size: 25 });
    expect(client.query.mock.calls[0][1]).toEqual({ page: 1, pageSize: 25, email: undefined });
    expect(result.data).toMatchObject({ total_count: 1, has_more: false });
    expect((result.data.items as unknown[])[0]).toEqual({
      id: "C1", name: "Acme Paints", first_name: "Ana", last_name: "Lee", email: "ana@acme.test", phone: null,
      currency: "CAD", is_archived: false, outstanding: "1130.00", overdue: "0.00",
      address: { line1: "1 Main St", line2: null, city: "Toronto", province: "Ontario", country: "CA", postal_code: "M1M 1M1" },
    });
  });

  it("searches by name across pages, case-insensitively", async () => {
    const client = fakeClient();
    client.query
      .mockResolvedValueOnce(page([raw({ id: "C1", name: "Acme Paints" }), raw({ id: "C2", name: "Borealis" })], 1, 2))
      .mockResolvedValueOnce(page([raw({ id: "C3", name: "ACME Hardware" })], 2, 2));
    const result = await listCustomers(client, { name: "acme", page: 1, page_size: 25 });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0][1]).toMatchObject({ page: 1, pageSize: 100 });
    expect((result.data.items as { id: string }[]).map((c) => c.id)).toEqual(["C1", "C3"]);
    expect(result.data).toMatchObject({ total_count: 2, scan_truncated: false });
  });

  it("flags a truncated name scan", async () => {
    const client = fakeClient();
    client.query.mockImplementation(async (_doc: string, vars: { page: number }) => page([raw()], vars.page, 9));
    const result = await listCustomers(client, { name: "acme", page: 1, page_size: 25 });
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(result.data.scan_truncated).toBe(true);
  });

  it("handles a customer with no address or currency", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue(page([raw({ address: null, currency: null })]));
    const result = await listCustomers(client, { page: 1, page_size: 25 });
    expect((result.data.items as { address: unknown; currency: unknown }[])[0]).toMatchObject({ address: null, currency: null });
  });
});

describe("wave_get_customer", () => {
  it("refuses an id that is not in the pinned business", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { customer: null } });
    await expect(getCustomer(client, { customer_id: "OTHER" })).rejects.toThrow(/wave_list_customers/);
  });
});

describe("wave_create_customer", () => {
  it("sends the pinned business id and maps fields", async () => {
    const client = fakeClient();
    client.mutate.mockResolvedValue({ customerCreate: { didSucceed: true, inputErrors: [], customer: raw() } });
    const result = await createCustomer(client, {
      name: "Acme Paints", email: "ana@acme.test", currency: "CAD",
      address: { line1: "1 Main St", city: "Toronto", province_code: "CA-ON", country_code: "CA", postal_code: "M1M 1M1" },
    });
    expect(client.mutate.mock.calls[0][1]).toEqual({
      businessId: "BIZ", name: "Acme Paints", email: "ana@acme.test", currency: "CAD",
      address: { addressLine1: "1 Main St", city: "Toronto", provinceCode: "CA-ON", countryCode: "CA", postalCode: "M1M 1M1" },
    });
    expect(result.data.id).toBe("C1");
  });

  it("surfaces Wave input errors", async () => {
    const client = fakeClient();
    client.mutate.mockResolvedValue({
      customerCreate: { didSucceed: false, inputErrors: [{ path: ["input", "email"], message: "Enter a valid email." }], customer: null },
    });
    await expect(createCustomer(client, { name: "X", email: "bad" })).rejects.toThrow(/input\.email: Enter a valid email\./);
  });
});

describe("wave_update_customer", () => {
  it("checks the customer is in the pinned business before patching", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { customer: null } });
    await expect(updateCustomer(client, { customer_id: "OTHER", name: "New" })).rejects.toThrow(/No customer/);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("sends only the fields provided", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: { customer: raw() } });
    client.mutate.mockResolvedValue({ customerPatch: { didSucceed: true, inputErrors: [], customer: raw({ email: "new@acme.test" }) } });
    const result = await updateCustomer(client, { customer_id: "C1", email: "new@acme.test" });
    expect(client.mutate.mock.calls[0][1]).toEqual({ id: "C1", email: "new@acme.test" });
    expect(result.data.email).toBe("new@acme.test");
  });

  it("refuses an update with no fields", async () => {
    const client = fakeClient();
    await expect(updateCustomer(client, { customer_id: "C1" })).rejects.toThrow(/at least one field/);
    expect(client.query).not.toHaveBeenCalled();
  });
});
