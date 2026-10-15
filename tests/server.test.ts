import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { rawInvoice } from "./fixtures.js";
import { fakeClient, type FakeClient } from "./helpers.js";

const READ = [
  "wave_get_business", "wave_list_customers", "wave_get_customer", "wave_list_invoices", "wave_get_invoice",
  "wave_list_products", "wave_list_sales_taxes", "wave_list_accounts",
];
const WRITE = ["wave_create_customer", "wave_update_customer", "wave_create_product", "wave_create_invoice", "wave_update_invoice"];
const GATED = ["wave_approve_invoice", "wave_send_invoice", "wave_mark_invoice_sent", "wave_record_payment"];

let wave: FakeClient;
let mcp: Client;
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];

beforeAll(async () => {
  wave = fakeClient();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer(wave).connect(serverTransport);
  mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientTransport);
  tools = (await mcp.listTools()).tools;
});

describe("tool surface", () => {
  it("exposes exactly the tools in the spec", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([...READ, ...WRITE, ...GATED].sort());
  });

  it("has no delete tool and no generic GraphQL tool", () => {
    for (const tool of tools) expect(tool.name).not.toMatch(/delete|graphql|estimate|transaction/);
  });

  it("never accepts a business id", () => {
    for (const tool of tools) {
      const properties = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
      expect(properties.filter((p) => /business/i.test(p))).toEqual([]);
    }
  });

  it("annotates read, write and gated tools correctly", () => {
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    for (const name of READ) expect(byName.get(name)).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const name of WRITE) expect(byName.get(name)).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    for (const name of GATED) expect(byName.get(name)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("gives every gated tool confirm and fingerprint inputs", () => {
    for (const tool of tools.filter((t) => GATED.includes(t.name))) {
      expect(Object.keys(tool.inputSchema.properties as object)).toEqual(expect.arrayContaining(["confirm", "fingerprint"]));
    }
  });

  it("does not expose a status input on invoice create or update", () => {
    for (const name of ["wave_create_invoice", "wave_update_invoice"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(Object.keys(tool.inputSchema.properties as object)).not.toContain("status");
    }
  });
});

describe("end to end through the MCP protocol", () => {
  it("returns structured content that passes the output schema", async () => {
    wave.query.mockResolvedValue({ business: { invoice: rawInvoice() } });
    const result = await mcp.callTool({ name: "wave_get_invoice", arguments: { invoice_id: "INV1" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "INV1", total: "1130.00" });
  });

  it("turns a Wave failure into an isError result with the actionable message", async () => {
    wave.query.mockResolvedValue({ business: { invoice: null } });
    const result = await mcp.callTool({ name: "wave_get_invoice", arguments: { invoice_id: "NOPE" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("wave_list_invoices");
  });

  it("rejects invalid input before any Wave call", async () => {
    wave.query.mockClear();
    const result = await mcp
      .callTool({ name: "wave_list_invoices", arguments: { invoice_date_start: "2026-02-30" } })
      .catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
    expect(result.isError).toBe(true);
    expect(wave.query).not.toHaveBeenCalled();
  });

  it("previews a gated tool by default", async () => {
    wave.query.mockResolvedValue({ business: { invoice: rawInvoice({ status: "DRAFT" }) } });
    const result = await mcp.callTool({ name: "wave_approve_invoice", arguments: { invoice_id: "INV1" } });
    expect(result.structuredContent).toMatchObject({ status: "preview" });
    expect(wave.mutate).not.toHaveBeenCalled();
  });
});
