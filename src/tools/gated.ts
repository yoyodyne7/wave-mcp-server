import { z } from "zod";
import type { WaveClient } from "../client.js";
import { checkGate } from "../confirm.js";
import { asText } from "../format.js";
import { invoiceDetailOut, type InvoiceDetail } from "../queries/invoices.js";
import { describeInvoice, fetchInvoice, snapshotOf } from "./invoices.js";
import type { ToolResult } from "./register.js";

export interface GateArgs {
  confirm?: boolean;
  fingerprint?: string;
}

export const gateInput = {
  confirm: z
    .boolean()
    .default(false)
    .describe(
      "Leave false to get a preview (nothing happens). Set true only after the user has seen the preview " +
        "and agreed, and pass the preview's fingerprint.",
    ),
  fingerprint: z.string().optional().describe("The fingerprint returned by the preview call; required with confirm: true"),
};

export const gateOutput = {
  status: z.enum(["preview", "done"]),
  message: z.string(),
  fingerprint: z.string().optional(),
  preview: z.record(z.unknown()).optional(),
  invoice: z.object(invoiceDetailOut).optional(),
};

export async function runGated(opts: {
  client: WaveClient;
  tool: string;
  invoice: InvoiceDetail;
  inputs: Record<string, unknown>;
  args: GateArgs;
  preview: Record<string, unknown>;
  summary: string;
  execute: () => Promise<void>;
}): Promise<ToolResult> {
  const gate = checkGate({
    tool: opts.tool,
    snapshot: snapshotOf(opts.invoice),
    inputs: opts.inputs,
    confirm: opts.args.confirm,
    fingerprint: opts.args.fingerprint,
  });

  if (!gate.proceed) {
    const message =
      gate.reason === "mismatch"
        ? "The invoice or the inputs changed since the preview, so NOTHING was done. Show this new " +
          "preview to the user and confirm again with the new fingerprint."
        : `PREVIEW ONLY, nothing has happened yet. ${opts.summary} Show this to the user; if they agree, ` +
          `call ${opts.tool} again with the same inputs plus confirm: true and this fingerprint.`;
    const data = { status: "preview" as const, message, fingerprint: gate.fingerprint, preview: opts.preview };
    return { text: asText(message, data), data };
  }

  await opts.execute();
  // The action is done. A failed re-read must not be reported as a failed action, or the
  // caller may repeat an email or a payment.
  try {
    const invoice = await fetchInvoice(opts.client, opts.invoice.id);
    const message = `Done. ${describeInvoice(invoice)}.`;
    const data = { status: "done" as const, message, invoice };
    return { text: asText(message, data), data };
  } catch {
    const message =
      `The action succeeded for invoice #${opts.invoice.invoice_number}, but Wave could not be ` +
      "re-read afterwards. Do NOT repeat this action; check the invoice later with wave_get_invoice.";
    const data = { status: "done" as const, message };
    return { text: asText(message, data), data };
  }
}
