import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WaveClient } from "../client.js";
import { WaveError, assertSucceeded, notFound, requireBusiness, type MutationPayload } from "../errors.js";
import { asText, pageEnvelope, type Connection } from "../format.js";
import {
  CREATE_CUSTOMER,
  GET_CUSTOMER,
  LIST_CUSTOMERS,
  PATCH_CUSTOMER,
  customerOut,
  mapCustomer,
  type Customer,
  type RawCustomer,
} from "../queries/customers.js";
import { currencyCode, id, pageOutput, paging } from "../schemas.js";
import { registerTool, type ToolResult } from "./register.js";

const SCAN_PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 5;

type ListData = { business: { customers: Connection<RawCustomer> } | null };

async function fetchPage(client: WaveClient, page: number, pageSize: number, email?: string) {
  const data = await client.query<ListData>(LIST_CUSTOMERS, { page, pageSize, email });
  return requireBusiness(data.business).customers;
}

export async function listCustomers(
  client: WaveClient,
  args: { email?: string; name?: string; page: number; page_size: number },
): Promise<ToolResult> {
  if (!args.name) {
    const connection = await fetchPage(client, args.page, args.page_size, args.email);
    const data = pageEnvelope(connection.edges.map((e) => mapCustomer(e.node)), connection.pageInfo, args.page_size);
    return { text: asText(`${data.total_count} customer(s); page ${data.page} of ${data.total_pages}.`, data), data };
  }

  const needle = args.name.toLowerCase();
  const matches: Customer[] = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    const connection = await fetchPage(client, page, SCAN_PAGE_SIZE, args.email);
    for (const edge of connection.edges) {
      if (edge.node.name.toLowerCase().includes(needle)) matches.push(mapCustomer(edge.node));
    }
    if (page >= connection.pageInfo.totalPages) break;
    if (page >= MAX_SCAN_PAGES) {
      truncated = true;
      break;
    }
  }
  const totalPages = Math.max(1, Math.ceil(matches.length / args.page_size));
  const start = (args.page - 1) * args.page_size;
  const data = {
    ...pageEnvelope(
      matches.slice(start, start + args.page_size),
      { currentPage: args.page, totalPages, totalCount: matches.length },
      args.page_size,
    ),
    scan_truncated: truncated,
  };
  const note = truncated
    ? ` Only the first ${SCAN_PAGE_SIZE * MAX_SCAN_PAGES} customers were searched; narrow with email.`
    : "";
  return { text: asText(`${matches.length} customer(s) matching "${args.name}".${note}`, data), data };
}

export async function fetchCustomer(client: WaveClient, customerId: string): Promise<Customer> {
  const data = await client.query<{ business: { customer: RawCustomer | null } | null }>(GET_CUSTOMER, { customerId });
  const customer = requireBusiness(data.business).customer;
  if (!customer) throw notFound("customer", customerId, "wave_list_customers");
  return mapCustomer(customer);
}

export async function getCustomer(client: WaveClient, args: { customer_id: string }): Promise<ToolResult> {
  const customer = await fetchCustomer(client, args.customer_id);
  return { text: asText(`Customer "${customer.name}".`, customer), data: customer };
}

const addressInput = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    province_code: z.string().optional().describe('ISO 3166-2 code, e.g. "CA-ON" or "US-NY"'),
    country_code: z.string().regex(/^[A-Z]{2}$/).optional().describe('2-letter country code, e.g. "CA" or "US"'),
    postal_code: z.string().optional(),
  })
  .strict();

const customerFields = {
  first_name: z.string().optional().describe("First name of the main contact"),
  last_name: z.string().optional().describe("Last name of the main contact"),
  email: z.string().email().optional().describe("Email of the main contact; invoices are sent here"),
  phone: z.string().optional(),
  currency: currencyCode.optional().describe("Default currency for this customer's invoices"),
  address: addressInput.optional(),
  internal_notes: z.string().optional().describe("Notes visible only inside Wave"),
};

interface CustomerFieldArgs {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  currency?: string;
  address?: z.infer<typeof addressInput>;
  internal_notes?: string;
}

function compact<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function toWaveInput(args: CustomerFieldArgs): Record<string, unknown> {
  return compact({
    name: args.name,
    firstName: args.first_name,
    lastName: args.last_name,
    email: args.email,
    phone: args.phone,
    currency: args.currency,
    internalNotes: args.internal_notes,
    address: args.address
      ? compact({
          addressLine1: args.address.line1,
          addressLine2: args.address.line2,
          city: args.address.city,
          provinceCode: args.address.province_code,
          countryCode: args.address.country_code,
          postalCode: args.address.postal_code,
        })
      : undefined,
  });
}

type CustomerPayload = MutationPayload & { customer: RawCustomer | null };

function resultOf(action: string, payload: CustomerPayload): ToolResult {
  assertSucceeded(action, payload);
  if (!payload.customer) throw new WaveError("BAD_RESPONSE", `Wave reported success but returned no customer.`);
  const customer = mapCustomer(payload.customer);
  return { text: asText(`Customer "${customer.name}" saved.`, customer), data: customer };
}

export async function createCustomer(
  client: WaveClient,
  args: CustomerFieldArgs & { name: string },
): Promise<ToolResult> {
  const data = await client.mutate<{ customerCreate: CustomerPayload }>(CREATE_CUSTOMER, {
    businessId: client.businessId,
    ...toWaveInput(args),
  });
  return resultOf("create the customer", data.customerCreate);
}

export async function updateCustomer(
  client: WaveClient,
  args: CustomerFieldArgs & { customer_id: string },
): Promise<ToolResult> {
  const { customer_id, ...fields } = args;
  const input = toWaveInput(fields);
  if (Object.keys(input).length === 0) {
    throw new WaveError("NOTHING_TO_UPDATE", "Provide at least one field to change.");
  }
  await fetchCustomer(client, customer_id);
  const data = await client.mutate<{ customerPatch: CustomerPayload }>(PATCH_CUSTOMER, { id: customer_id, ...input });
  return resultOf("update the customer", data.customerPatch);
}

export function registerCustomerTools(server: McpServer, client: WaveClient): void {
  registerTool(server, client, {
    name: "wave_list_customers",
    title: "List Wave customers",
    description:
      "List customers of the pinned Wave business, sorted by name. Filter by exact `email`, or by `name` " +
      "(case-insensitive contains; searches up to 500 customers and sets scan_truncated if there are more). " +
      "Returns id, contact details, default currency and outstanding/overdue amounts. " +
      "Use the id with wave_create_invoice or wave_list_invoices.",
    kind: "read",
    inputSchema: {
      email: z.string().email().optional().describe("Exact email address to match"),
      name: z.string().min(1).optional().describe('Part of the customer name, e.g. "acme"'),
      ...paging,
    },
    outputSchema: { ...pageOutput(z.object(customerOut)), scan_truncated: z.boolean().optional() },
    handler: listCustomers,
  });

  registerTool(server, client, {
    name: "wave_get_customer",
    title: "Get Wave customer",
    description: "Get one customer by id, including address, default currency and outstanding/overdue amounts.",
    kind: "read",
    inputSchema: { customer_id: id("Customer") },
    outputSchema: customerOut,
    handler: getCustomer,
  });

  registerTool(server, client, {
    name: "wave_create_customer",
    title: "Create Wave customer",
    description:
      "Create a customer in the pinned Wave business. Check wave_list_customers first to avoid duplicates. " +
      "Set `currency` for clients billed in a currency other than the business default (e.g. USD for US clients).",
    kind: "write",
    inputSchema: { name: z.string().min(1).describe("Customer or company name"), ...customerFields },
    outputSchema: customerOut,
    handler: createCustomer,
  });

  registerTool(server, client, {
    name: "wave_update_customer",
    title: "Update Wave customer",
    description: "Change fields on an existing customer. Only the fields you pass are changed.",
    kind: "write",
    inputSchema: { customer_id: id("Customer"), name: z.string().min(1).optional(), ...customerFields },
    outputSchema: customerOut,
    handler: updateCustomer,
  });
}
