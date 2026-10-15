import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WaveClient } from "../client.js";
import { requireBusiness } from "../errors.js";
import { asText } from "../format.js";
import { registerTool, type ToolResult } from "./register.js";

const GET_BUSINESS = `query GetBusiness($businessId: ID!) {
  business(id: $businessId) { id name isPersonal timezone emailSendEnabled currency { code } }
}`;

const businessOut = {
  id: z.string(),
  name: z.string(),
  currency: z.string(),
  timezone: z.string().nullable(),
  is_personal: z.boolean(),
  email_send_enabled: z.boolean(),
};

export type Business = z.infer<z.ZodObject<typeof businessOut>>;

interface RawBusiness {
  id: string;
  name: string;
  isPersonal: boolean;
  timezone: string | null;
  emailSendEnabled: boolean;
  currency: { code: string };
}

export async function fetchBusiness(client: WaveClient): Promise<Business> {
  const data = await client.query<{ business: RawBusiness | null }>(GET_BUSINESS);
  const b = requireBusiness(data.business);
  return {
    id: b.id,
    name: b.name,
    currency: b.currency.code,
    timezone: b.timezone ?? null,
    is_personal: b.isPersonal,
    email_send_enabled: b.emailSendEnabled,
  };
}

export async function getBusiness(client: WaveClient): Promise<ToolResult> {
  const business = await fetchBusiness(client);
  return { text: asText(`Connected to Wave business "${business.name}".`, business), data: business };
}

export function registerBusinessTools(server: McpServer, client: WaveClient): void {
  registerTool(server, client, {
    name: "wave_get_business",
    title: "Get Wave business",
    description:
      "Show the Wave business this server is pinned to: name, default currency, timezone and whether " +
      "Wave email sending is enabled. Use it to check the connection before other tools. " +
      "All wave_* tools act on this one business only.",
    kind: "read",
    inputSchema: {},
    outputSchema: businessOut,
    handler: (c) => getBusiness(c),
  });
}
