import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WaveClient } from "./client.js";
import { registerBusinessTools } from "./tools/business.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerInvoiceActionTools } from "./tools/invoice-actions.js";
import { registerPaymentTools } from "./tools/payments.js";

export function buildServer(client: WaveClient): McpServer {
  const server = new McpServer({ name: "wave-mcp-server", version: "0.1.0" });
  registerBusinessTools(server, client);
  registerCustomerTools(server, client);
  registerCatalogTools(server, client);
  registerInvoiceTools(server, client);
  registerInvoiceActionTools(server, client);
  registerPaymentTools(server, client);
  return server;
}
