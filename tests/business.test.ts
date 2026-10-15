import { describe, expect, it } from "vitest";
import { getBusiness } from "../src/tools/business.js";
import { fakeClient } from "./helpers.js";

describe("wave_get_business", () => {
  it("returns the pinned business", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({
      business: { id: "BIZ", name: "Acme Inc.", isPersonal: false, timezone: "America/Toronto", emailSendEnabled: true, currency: { code: "CAD" } },
    });
    const result = await getBusiness(client);
    expect(result.data).toEqual({
      id: "BIZ", name: "Acme Inc.", currency: "CAD", timezone: "America/Toronto", is_personal: false, email_send_enabled: true,
    });
    expect(result.text).toContain("Acme Inc.");
    expect(client.query.mock.calls[0][0]).toContain("business(id: $businessId)");
  });

  it("explains a business id the token cannot see", async () => {
    const client = fakeClient();
    client.query.mockResolvedValue({ business: null });
    await expect(getBusiness(client)).rejects.toThrow(/--list-businesses/);
  });
});
