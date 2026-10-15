import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WaveClient } from "../client.js";
import { WaveError, assertSucceeded, type MutationPayload } from "../errors.js";
import { APPROVE_INVOICE, MARK_INVOICE_SENT, SEND_INVOICE, type InvoiceDetail } from "../queries/invoices.js";
import { id } from "../schemas.js";
import { fetchBusiness } from "./business.js";
import { gateInput, gateOutput, runGated, type GateArgs } from "./gated.js";
import { fetchInvoice } from "./invoices.js";
import { registerTool, type ToolResult } from "./register.js";

function invoicePreview(invoice: InvoiceDetail): Record<string, unknown> {
  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    customer: invoice.customer_name,
    customer_email: invoice.customer_email,
    currency: invoice.currency,
    total: invoice.total,
    tax_total: invoice.tax_total,
    amount_due: invoice.amount_due,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    items: invoice.items.map((item) => ({
      product: item.product_name,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.total,
      taxes: item.taxes.map((t) => t.abbreviation),
    })),
  };
}

function requireApproved(invoice: InvoiceDetail, action: string): void {
  if (invoice.status === "DRAFT") {
    throw new WaveError(
      "STILL_A_DRAFT",
      `Invoice #${invoice.invoice_number} is still a draft. Approve it with wave_approve_invoice before you ${action}.`,
    );
  }
}

export async function approveInvoice(
  client: WaveClient,
  args: { invoice_id: string } & GateArgs,
): Promise<ToolResult> {
  const invoice = await fetchInvoice(client, args.invoice_id);
  if (invoice.status !== "DRAFT") {
    throw new WaveError(
      "ALREADY_APPROVED",
      `Invoice #${invoice.invoice_number} is already ${invoice.status}; only drafts can be approved.`,
    );
  }
  return runGated({
    client,
    tool: "wave_approve_invoice",
    invoice,
    inputs: {},
    args,
    preview: invoicePreview(invoice),
    summary:
      `Approving invoice #${invoice.invoice_number} for ${invoice.customer_name} ` +
      `(${invoice.total} ${invoice.currency}, tax ${invoice.tax_total}) will post it to the books.`,
    execute: async () => {
      const res = await client.mutate<{ invoiceApprove: MutationPayload }>(APPROVE_INVOICE, { invoiceId: invoice.id });
      assertSucceeded("approve the invoice", res.invoiceApprove);
    },
  });
}

export async function sendInvoice(
  client: WaveClient,
  args: {
    invoice_id: string;
    to: string[];
    subject?: string;
    message?: string;
    attach_pdf: boolean;
    cc_myself: boolean;
  } & GateArgs,
): Promise<ToolResult> {
  const invoice = await fetchInvoice(client, args.invoice_id);
  requireApproved(invoice, "send it");
  const business = await fetchBusiness(client);
  if (!business.email_send_enabled) {
    throw new WaveError(
      "EMAIL_SEND_DISABLED",
      "Wave email sending is not enabled for this business, so Wave cannot email the invoice. Send it " +
        `yourself (PDF: ${invoice.pdf_url}) and then record that with wave_mark_invoice_sent.`,
    );
  }

  const customerEmail = invoice.customer_email?.toLowerCase() ?? null;
  const matches = customerEmail !== null && args.to.some((address) => address.toLowerCase() === customerEmail);
  const inputs = {
    to: args.to,
    subject: args.subject,
    message: args.message,
    attach_pdf: args.attach_pdf,
    cc_myself: args.cc_myself,
  };
  const warning = matches
    ? ""
    : ` WARNING: none of the recipients is the customer's email on file (${invoice.customer_email ?? "none on file"}); ` +
      "this is not the customer's email.";

  return runGated({
    client,
    tool: "wave_send_invoice",
    invoice,
    inputs,
    args,
    preview: { ...invoicePreview(invoice), ...inputs, recipient_matches_customer: matches },
    summary:
      `Wave will EMAIL invoice #${invoice.invoice_number} (${invoice.total} ${invoice.currency}, ` +
      `tax ${invoice.tax_total}) for ${invoice.customer_name} to ${args.to.join(", ")}.${warning}`,
    execute: async () => {
      const input: Record<string, unknown> = {
        invoiceId: invoice.id,
        to: args.to,
        attachPDF: args.attach_pdf,
        ccMyself: args.cc_myself,
      };
      if (args.subject !== undefined) input.subject = args.subject;
      if (args.message !== undefined) input.message = args.message;
      const res = await client.mutate<{ invoiceSend: MutationPayload }>(SEND_INVOICE, input);
      assertSucceeded("send the invoice", res.invoiceSend);
    },
  });
}

const SEND_METHODS = ["MARKED_SENT", "EXPORT_PDF", "SHARED_LINK", "GMAIL", "OUTLOOK", "YAHOO"] as const;

export async function markInvoiceSent(
  client: WaveClient,
  args: { invoice_id: string; send_method: (typeof SEND_METHODS)[number] } & GateArgs,
): Promise<ToolResult> {
  const invoice = await fetchInvoice(client, args.invoice_id);
  requireApproved(invoice, "mark it sent");
  const inputs = { send_method: args.send_method };
  return runGated({
    client,
    tool: "wave_mark_invoice_sent",
    invoice,
    inputs,
    args,
    preview: { ...invoicePreview(invoice), ...inputs },
    summary:
      `Invoice #${invoice.invoice_number} for ${invoice.customer_name} will be marked as sent ` +
      `(${args.send_method}). Wave will NOT email anyone.`,
    execute: async () => {
      const res = await client.mutate<{ invoiceMarkSent: MutationPayload }>(MARK_INVOICE_SENT, {
        invoiceId: invoice.id,
        sendMethod: args.send_method,
      });
      assertSucceeded("mark the invoice as sent", res.invoiceMarkSent);
    },
  });
}

const GATE_NOTE =
  " This is a two-step tool: the first call (confirm omitted) returns a preview and a fingerprint and changes " +
  "nothing. Show the preview to the user. Only after they agree, call again with confirm: true and the fingerprint.";

export function registerInvoiceActionTools(server: McpServer, client: WaveClient): void {
  registerTool(server, client, {
    name: "wave_approve_invoice",
    title: "Approve Wave invoice",
    description:
      "Approve a DRAFT invoice, which posts it to the books and makes it sendable. It does not email anyone." +
      GATE_NOTE,
    kind: "gated",
    inputSchema: { invoice_id: id("Invoice"), ...gateInput },
    outputSchema: gateOutput,
    handler: approveInvoice,
  });

  registerTool(server, client, {
    name: "wave_send_invoice",
    title: "Email Wave invoice to client",
    description:
      "Have Wave EMAIL an approved invoice to the given addresses. This reaches a real client and cannot be " +
      "unsent. The preview shows recipients, subject, totals and tax, and whether a recipient matches the " +
      "customer's email on file." +
      GATE_NOTE,
    kind: "gated",
    inputSchema: {
      invoice_id: id("Invoice"),
      to: z.array(z.string().email()).min(1).describe("Recipient email addresses"),
      subject: z.string().min(1).optional().describe("Email subject (default: Wave's standard subject)"),
      message: z.string().optional().describe("Email body text (default: Wave's standard message)"),
      attach_pdf: z.boolean().default(true).describe("Attach the invoice PDF (default true)"),
      cc_myself: z.boolean().default(false).describe("Send a copy to the Wave account owner (default false)"),
      ...gateInput,
    },
    outputSchema: gateOutput,
    handler: sendInvoice,
  });

  registerTool(server, client, {
    name: "wave_mark_invoice_sent",
    title: "Mark Wave invoice as sent",
    description:
      "Record that an approved invoice was sent outside Wave (e.g. from your own email). Wave emails no one." +
      GATE_NOTE,
    kind: "gated",
    inputSchema: {
      invoice_id: id("Invoice"),
      send_method: z.enum(SEND_METHODS).default("MARKED_SENT").describe("How it was sent (default MARKED_SENT)"),
      ...gateInput,
    },
    outputSchema: gateOutput,
    handler: markInvoiceSent,
  });
}
