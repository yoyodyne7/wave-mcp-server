import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WaveClient } from "../client.js";
import type { InvoiceSnapshot } from "../confirm.js";
import { WaveError, assertSucceeded, notFound, requireBusiness, type MutationPayload } from "../errors.js";
import { asText, pageEnvelope, type Connection } from "../format.js";
import {
  CREATE_INVOICE,
  GET_INVOICE,
  INVOICE_STATUSES,
  LIST_INVOICES,
  PATCH_INVOICE,
  invoiceDetailOut,
  invoiceSummaryOut,
  mapInvoiceDetail,
  mapInvoiceSummary,
  type InvoiceDetail,
  type RawInvoiceDetail,
  type RawInvoiceSummary,
} from "../queries/invoices.js";
import { currencyCode, decimal, id, isoDate, pageOutput, paging, positiveDecimal } from "../schemas.js";
import { fetchCustomer } from "./customers.js";
import { registerTool, type ToolResult } from "./register.js";

export async function listInvoices(
  client: WaveClient,
  args: {
    status?: string;
    customer_id?: string;
    currency?: string;
    invoice_date_start?: string;
    invoice_date_end?: string;
    invoice_number?: string;
    page: number;
    page_size: number;
  },
): Promise<ToolResult> {
  const res = await client.query<{ business: { invoices: Connection<RawInvoiceSummary> } | null }>(LIST_INVOICES, {
    page: args.page,
    pageSize: args.page_size,
    status: args.status,
    customerId: args.customer_id,
    currency: args.currency,
    invoiceDateStart: args.invoice_date_start,
    invoiceDateEnd: args.invoice_date_end,
    invoiceNumber: args.invoice_number,
  });
  const connection = requireBusiness(res.business).invoices;
  const data = pageEnvelope(connection.edges.map((e) => mapInvoiceSummary(e.node)), connection.pageInfo, args.page_size);
  return { text: asText(`${data.total_count} invoice(s); page ${data.page} of ${data.total_pages}.`, data), data };
}

export async function fetchInvoice(client: WaveClient, invoiceId: string): Promise<InvoiceDetail> {
  const res = await client.query<{ business: { invoice: RawInvoiceDetail | null } | null }>(GET_INVOICE, { invoiceId });
  const invoice = requireBusiness(res.business).invoice;
  if (!invoice) throw notFound("invoice", invoiceId, "wave_list_invoices");
  return mapInvoiceDetail(invoice);
}

export function snapshotOf(invoice: InvoiceDetail): InvoiceSnapshot {
  return {
    id: invoice.id,
    status: invoice.status,
    total: invoice.total,
    amountDue: invoice.amount_due,
    modifiedAt: invoice.modified_at,
  };
}

export const describeInvoice = (i: InvoiceDetail) =>
  `Invoice #${i.invoice_number} for ${i.customer_name}: ${i.total} ${i.currency} (${i.status}, ${i.amount_due} due)`;

export async function getInvoice(client: WaveClient, args: { invoice_id: string }): Promise<ToolResult> {
  const invoice = await fetchInvoice(client, args.invoice_id);
  return { text: asText(`${describeInvoice(invoice)}.`, invoice), data: invoice };
}

const itemInput = z
  .object({
    product_id: id("Product"),
    description: z.string().optional().describe("Overrides the product's description on this line"),
    quantity: positiveDecimal.optional().describe('Units as a decimal string, e.g. "1" or "2.5" (default 1)'),
    unit_price: decimal.optional().describe("Overrides the product's unit price, as a decimal string"),
    sales_tax_ids: z
      .array(id("Sales tax"))
      .optional()
      .describe(
        "Taxes for this line. OMIT to apply the product's default taxes. Pass [] for NO tax " +
          "(e.g. zero-rated US/export clients). Pass ids from wave_list_sales_taxes to set them explicitly.",
      ),
  })
  .strict();

type ItemArgs = z.infer<typeof itemInput>;

const invoiceFields = {
  invoice_date: isoDate.optional().describe("Issue date (default: today)"),
  due_date: isoDate.optional().describe("Due date (default: business payment terms)"),
  currency: currencyCode.optional().describe("Invoice currency (default: business currency)"),
  exchange_rate: positiveDecimal
    .optional()
    .describe("Rate from the invoice currency to the business currency; set it for foreign-currency invoices"),
  po_number: z.string().optional(),
  title: z.string().optional(),
  memo: z.string().optional().describe("Notes shown on the invoice"),
  footer: z.string().optional(),
};

interface InvoiceFieldArgs {
  customer_id?: string;
  items?: ItemArgs[];
  invoice_date?: string;
  due_date?: string;
  currency?: string;
  exchange_rate?: string;
  invoice_number?: string;
  po_number?: string;
  title?: string;
  memo?: string;
  footer?: string;
}

function toWaveItem(item: ItemArgs): Record<string, unknown> {
  const out: Record<string, unknown> = { productId: item.product_id };
  if (item.description !== undefined) out.description = item.description;
  if (item.quantity !== undefined) out.quantity = item.quantity;
  if (item.unit_price !== undefined) out.unitPrice = item.unit_price;
  // An explicit empty array must survive: it means "no tax", not "use the product default".
  if (item.sales_tax_ids !== undefined) out.taxes = item.sales_tax_ids.map((salesTaxId) => ({ salesTaxId }));
  return out;
}

function toWaveInvoice(args: InvoiceFieldArgs): Record<string, unknown> {
  const pairs: [string, unknown][] = [
    ["customerId", args.customer_id],
    ["invoiceDate", args.invoice_date],
    ["dueDate", args.due_date],
    ["currency", args.currency],
    ["exchangeRate", args.exchange_rate],
    ["invoiceNumber", args.invoice_number],
    ["poNumber", args.po_number],
    ["title", args.title],
    ["memo", args.memo],
    ["footer", args.footer],
    ["items", args.items?.map(toWaveItem)],
  ];
  return Object.fromEntries(pairs.filter(([, value]) => value !== undefined));
}

type InvoicePayload = MutationPayload & { invoice: RawInvoiceDetail | null };

function resultOf(action: string, verb: string, payload: InvoicePayload): ToolResult {
  assertSucceeded(action, payload);
  if (!payload.invoice) throw new WaveError("BAD_RESPONSE", "Wave reported success but returned no invoice.");
  const invoice = mapInvoiceDetail(payload.invoice);
  return { text: asText(`${verb}: ${describeInvoice(invoice)}.`, invoice), data: invoice };
}

export async function createInvoice(
  client: WaveClient,
  args: InvoiceFieldArgs & { customer_id: string; items: ItemArgs[] },
): Promise<ToolResult> {
  await fetchCustomer(client, args.customer_id);
  const res = await client.mutate<{ invoiceCreate: InvoicePayload }>(CREATE_INVOICE, {
    businessId: client.businessId,
    status: "DRAFT",
    ...toWaveInvoice(args),
  });
  return resultOf("create the invoice", "Draft created", res.invoiceCreate);
}

export async function updateInvoice(
  client: WaveClient,
  args: InvoiceFieldArgs & { invoice_id: string },
): Promise<ToolResult> {
  const { invoice_id, ...fields } = args;
  const input = toWaveInvoice(fields);
  if (Object.keys(input).length === 0) {
    throw new WaveError("NOTHING_TO_UPDATE", "Provide at least one field to change.");
  }
  const current = await fetchInvoice(client, invoice_id);
  if (current.status !== "DRAFT") {
    throw new WaveError(
      "NOT_A_DRAFT",
      `Invoice #${current.invoice_number} is ${current.status}; this tool only edits drafts. ` +
        "Edit approved or sent invoices in Wave.",
    );
  }
  if (fields.customer_id !== undefined) await fetchCustomer(client, fields.customer_id);
  const res = await client.mutate<{ invoicePatch: InvoicePayload }>(PATCH_INVOICE, { id: invoice_id, ...input });
  return resultOf("update the invoice", "Draft updated", res.invoicePatch);
}

export function registerInvoiceTools(server: McpServer, client: WaveClient): void {
  registerTool(server, client, {
    name: "wave_list_invoices",
    title: "List Wave invoices",
    description:
      "List invoices of the pinned Wave business, newest invoice date first. Filter by status, customer, " +
      "currency, invoice date range or invoice number (contains match). Returns summaries; use " +
      "wave_get_invoice for line items and payments. For accounts receivable, list status OVERDUE or UNPAID.",
    kind: "read",
    inputSchema: {
      status: z.enum(INVOICE_STATUSES).optional().describe("SAVED means approved but not yet sent"),
      customer_id: id("Customer").optional(),
      currency: currencyCode.optional(),
      invoice_date_start: isoDate.optional().describe("Invoices dated on or after this date"),
      invoice_date_end: isoDate.optional().describe("Invoices dated on or before this date"),
      invoice_number: z.string().min(1).optional().describe('Contains match: "12" also finds 112 and 120'),
      ...paging,
    },
    outputSchema: pageOutput(z.object(invoiceSummaryOut)),
    handler: listInvoices,
  });

  registerTool(server, client, {
    name: "wave_get_invoice",
    title: "Get Wave invoice",
    description:
      "Get one invoice with line items, taxes, payments, totals, amount due and the PDF and customer-view URLs.",
    kind: "read",
    inputSchema: { invoice_id: id("Invoice") },
    outputSchema: invoiceDetailOut,
    handler: getInvoice,
  });

  registerTool(server, client, {
    name: "wave_create_invoice",
    title: "Create draft Wave invoice",
    description:
      "Create a DRAFT invoice. Nothing is sent and nothing is posted to the books until " +
      "wave_approve_invoice and wave_send_invoice. Needs a customer id (wave_list_customers) and at least " +
      "one line item with a product id (wave_list_products). Tax per line: omit sales_tax_ids to use the " +
      "product's defaults, or pass [] for no tax (zero-rated US/export clients).",
    kind: "write",
    inputSchema: {
      customer_id: id("Customer"),
      items: z.array(itemInput).min(1).describe("Line items; at least one"),
      invoice_number: z.string().optional().describe("Default: Wave assigns the next number"),
      ...invoiceFields,
    },
    outputSchema: invoiceDetailOut,
    handler: createInvoice,
  });

  registerTool(server, client, {
    name: "wave_update_invoice",
    title: "Update draft Wave invoice",
    description:
      "Change a DRAFT invoice. Only the fields you pass are changed, except `items`, which replaces ALL " +
      "line items. Refuses invoices that are no longer drafts.",
    kind: "write",
    inputSchema: {
      invoice_id: id("Invoice"),
      customer_id: id("Customer").optional(),
      items: z.array(itemInput).min(1).optional().describe("Replaces all existing line items"),
      ...invoiceFields,
    },
    outputSchema: invoiceDetailOut,
    handler: updateInvoice,
  });
}
