import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WaveClient } from "../client.js";
import { WaveError, assertSucceeded, type MutationPayload } from "../errors.js";
import { compareDecimal, latestPaymentDate, subtractDecimal } from "../format.js";
import { RECORD_PAYMENT } from "../queries/invoices.js";
import { id, isoDate, positiveDecimal } from "../schemas.js";
import { fetchAccount } from "./catalog.js";
import { gateInput, gateOutput, runGated, type GateArgs } from "./gated.js";
import { fetchInvoice } from "./invoices.js";
import { registerTool, type ToolResult } from "./register.js";

const PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "CHEQUE", "CREDIT_CARD", "PAYPAL", "OTHER", "UNSPECIFIED"] as const;

export async function recordPayment(
  client: WaveClient,
  args: {
    invoice_id: string;
    amount: string;
    payment_date: string;
    payment_method: (typeof PAYMENT_METHODS)[number];
    payment_account_id: string;
    exchange_rate?: string;
    memo?: string;
  } & GateArgs,
  now: Date = new Date(),
): Promise<ToolResult> {
  const invoice = await fetchInvoice(client, args.invoice_id);
  if (invoice.status === "DRAFT") {
    throw new WaveError(
      "STILL_A_DRAFT",
      `Invoice #${invoice.invoice_number} is still a draft. Approve it with wave_approve_invoice before recording a payment.`,
    );
  }
  if (compareDecimal(invoice.amount_due, "0") <= 0) {
    throw new WaveError(
      "NOTHING_DUE",
      `Invoice #${invoice.invoice_number} has nothing due (status ${invoice.status}).`,
    );
  }
  if (compareDecimal(args.amount, invoice.amount_due) > 0) {
    throw new WaveError(
      "OVERPAYMENT",
      `${args.amount} is more than the ${invoice.amount_due} ${invoice.currency} due on invoice ` +
        `#${invoice.invoice_number}. Check the amount; record genuine overpayments in Wave directly.`,
    );
  }
  if (args.payment_date > latestPaymentDate(now)) {
    throw new WaveError("FUTURE_DATE", `Payment date ${args.payment_date} is in the future.`);
  }
  const account = await fetchAccount(client, args.payment_account_id);
  const currencyMismatch = account.currency !== invoice.currency;
  if (currencyMismatch && args.exchange_rate === undefined) {
    throw new WaveError(
      "EXCHANGE_RATE_REQUIRED",
      `Invoice #${invoice.invoice_number} is in ${invoice.currency} but "${account.name}" is a ` +
        `${account.currency} account. Pass exchange_rate (how many ${account.currency} one ` +
        `${invoice.currency} was worth on the payment date) so the deposit is booked at the right value.`,
    );
  }
  const exchangeRate = args.exchange_rate ?? "1";

  const inputs = {
    amount: args.amount,
    payment_date: args.payment_date,
    payment_method: args.payment_method,
    payment_account_id: args.payment_account_id,
    exchange_rate: exchangeRate,
    memo: args.memo,
  };
  const after = subtractDecimal(invoice.amount_due, args.amount);

  return runGated({
    client,
    tool: "wave_record_payment",
    invoice,
    inputs,
    args,
    preview: {
      invoice_number: invoice.invoice_number,
      customer: invoice.customer_name,
      currency: invoice.currency,
      amount: args.amount,
      payment_date: args.payment_date,
      payment_method: args.payment_method,
      deposit_account: account.name,
      deposit_account_currency: account.currency,
      currency_mismatch: currencyMismatch,
      exchange_rate: exchangeRate,
      memo: args.memo ?? null,
      amount_due_before: invoice.amount_due,
      amount_due_after: after,
    },
    summary:
      `A payment of ${args.amount} ${invoice.currency} dated ${args.payment_date} (${args.payment_method}) ` +
      `into "${account.name}" will be recorded against invoice #${invoice.invoice_number} for ` +
      `${invoice.customer_name}, leaving ${after} due.` +
      (currencyMismatch
        ? ` The deposit is in ${account.currency} at an exchange rate of ${exchangeRate} ${account.currency} per ${invoice.currency}.`
        : ""),
    execute: async () => {
      const input: Record<string, unknown> = {
        invoiceId: invoice.id,
        paymentAccountId: args.payment_account_id,
        amount: args.amount,
        paymentDate: args.payment_date,
        paymentMethod: args.payment_method,
        exchangeRate,
      };
      if (args.memo !== undefined) input.memo = args.memo;
      const res = await client.mutate<{ invoicePaymentCreateManual: MutationPayload }>(RECORD_PAYMENT, input);
      assertSucceeded("record the payment", res.invoicePaymentCreateManual);
    },
  });
}

export function registerPaymentTools(server: McpServer, client: WaveClient): void {
  registerTool(server, client, {
    name: "wave_record_payment",
    title: "Record payment on Wave invoice",
    description:
      "Record a payment the business has ALREADY received against an approved invoice. This changes the " +
      "books; it does not move money. `amount` is in the invoice's currency and may not exceed the amount " +
      'due. `payment_account_id` is the account the money landed in: wave_list_accounts with subtypes ' +
      '["CASH_AND_BANK"]. This is a two-step tool: the first call (confirm omitted) returns a preview and a ' +
      "fingerprint and changes nothing. Show the preview to the user. Only after they agree, call again " +
      "with confirm: true and the fingerprint.",
    kind: "gated",
    inputSchema: {
      invoice_id: id("Invoice"),
      amount: positiveDecimal.describe('Amount received, in the invoice currency, e.g. "1130.00"'),
      payment_date: isoDate.describe("Date the payment was actually received (YYYY-MM-DD)"),
      payment_method: z.enum(PAYMENT_METHODS).describe("How it was paid; e-transfers are BANK_TRANSFER"),
      payment_account_id: id("Deposit account"),
      exchange_rate: positiveDecimal
        .optional()
        .describe(
          "Rate from the invoice currency to the deposit account's currency. Omit when they match. " +
            "REQUIRED when they differ (e.g. a USD invoice paid into a CAD account); never guess it, ask the user.",
        ),
      memo: z.string().optional().describe("Internal note on the payment"),
      ...gateInput,
    },
    outputSchema: gateOutput,
    handler: (c, args) => recordPayment(c, args),
  });
}
