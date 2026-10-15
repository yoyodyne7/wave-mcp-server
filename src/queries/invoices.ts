import { z } from "zod";
import { amount, type Money } from "../format.js";

const MONEY = `{ value currency { code } }`;
const SUMMARY_FIELDS = `id invoiceNumber status invoiceDate dueDate modifiedAt
  customer { id name email } currency { code } total ${MONEY} amountDue ${MONEY}`;
const DETAIL_FIELDS = `${SUMMARY_FIELDS}
  title subhead poNumber memo footer pdfUrl viewUrl exchangeRate
  amountPaid ${MONEY} taxTotal ${MONEY}
  items {
    description quantity unitPrice subtotal ${MONEY} total ${MONEY}
    product { id name }
    taxes { amount ${MONEY} salesTax { id abbreviation rate } }
  }
  payments { id paymentDate amount paymentMethod memo account { id name } }`;

export const LIST_INVOICES = `query ListInvoices($businessId: ID!, $page: Int!, $pageSize: Int!, $status: InvoiceStatus, $customerId: ID, $currency: CurrencyCode, $invoiceDateStart: Date, $invoiceDateEnd: Date, $invoiceNumber: String) {
  business(id: $businessId) {
    invoices(page: $page, pageSize: $pageSize, sort: [INVOICE_DATE_DESC], status: $status, customerId: $customerId, currency: $currency, invoiceDateStart: $invoiceDateStart, invoiceDateEnd: $invoiceDateEnd, invoiceNumber: $invoiceNumber) {
      pageInfo { currentPage totalPages totalCount }
      edges { node { ${SUMMARY_FIELDS} } }
    }
  }
}`;

export const GET_INVOICE = `query GetInvoice($businessId: ID!, $invoiceId: ID!) {
  business(id: $businessId) { invoice(id: $invoiceId) { ${DETAIL_FIELDS} } }
}`;

const PAYLOAD = `didSucceed inputErrors { path message code }`;

export const CREATE_INVOICE = `mutation CreateInvoice($input: InvoiceCreateInput!) {
  invoiceCreate(input: $input) { ${PAYLOAD} invoice { ${DETAIL_FIELDS} } }
}`;

export const PATCH_INVOICE = `mutation PatchInvoice($input: InvoicePatchInput!) {
  invoicePatch(input: $input) { ${PAYLOAD} invoice { ${DETAIL_FIELDS} } }
}`;

export const APPROVE_INVOICE = `mutation ApproveInvoice($input: InvoiceApproveInput!) {
  invoiceApprove(input: $input) { ${PAYLOAD} }
}`;

export const SEND_INVOICE = `mutation SendInvoice($input: InvoiceSendInput!) {
  invoiceSend(input: $input) { ${PAYLOAD} }
}`;

export const MARK_INVOICE_SENT = `mutation MarkInvoiceSent($input: InvoiceMarkSentInput!) {
  invoiceMarkSent(input: $input) { ${PAYLOAD} }
}`;

export const RECORD_PAYMENT = `mutation RecordPayment($input: InvoicePaymentCreateManualInput!) {
  invoicePaymentCreateManual(input: $input) { ${PAYLOAD} invoicePayment { id } }
}`;

export interface RawInvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  modifiedAt: string;
  customer: { id: string; name: string; email: string | null };
  currency: { code: string };
  total: Money;
  amountDue: Money;
}

export interface RawInvoiceDetail extends RawInvoiceSummary {
  title: string | null;
  subhead: string | null;
  poNumber: string | null;
  memo: string | null;
  footer: string | null;
  pdfUrl: string;
  viewUrl: string;
  exchangeRate: string | number;
  amountPaid: Money;
  taxTotal: Money;
  items:
    | {
        description: string | null;
        quantity: string | number;
        unitPrice: string | number;
        subtotal: Money;
        total: Money;
        product: { id: string; name: string };
        taxes: { amount: Money | null; salesTax: { id: string; abbreviation: string; rate: string | number } }[];
      }[]
    | null;
  payments:
    | ({
        id: string;
        paymentDate: string | null;
        amount: string | null;
        paymentMethod: string | null;
        memo: string | null;
        account: { id: string; name: string } | null;
      } | null)[]
    | null;
}

export const INVOICE_STATUSES = [
  "DRAFT", "OVERDUE", "OVERPAID", "PAID", "PARTIAL", "SAVED", "SENT", "UNPAID", "VIEWED",
] as const;

export const invoiceSummaryOut = {
  id: z.string(),
  invoice_number: z.string(),
  status: z.string(),
  invoice_date: z.string(),
  due_date: z.string(),
  customer_id: z.string(),
  customer_name: z.string(),
  currency: z.string(),
  total: z.string(),
  amount_due: z.string(),
  modified_at: z.string(),
};

export const invoiceDetailOut = {
  ...invoiceSummaryOut,
  customer_email: z.string().nullable(),
  title: z.string().nullable(),
  po_number: z.string().nullable(),
  memo: z.string().nullable(),
  footer: z.string().nullable(),
  pdf_url: z.string(),
  view_url: z.string(),
  exchange_rate: z.string(),
  amount_paid: z.string(),
  tax_total: z.string(),
  items: z.array(
    z.object({
      product_id: z.string(),
      product_name: z.string(),
      description: z.string().nullable(),
      quantity: z.string(),
      unit_price: z.string(),
      subtotal: z.string(),
      total: z.string(),
      taxes: z.array(
        z.object({ sales_tax_id: z.string(), abbreviation: z.string(), rate: z.string(), amount: z.string().nullable() }),
      ),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      payment_date: z.string().nullable(),
      amount: z.string().nullable(),
      payment_method: z.string().nullable(),
      memo: z.string().nullable(),
      account_id: z.string().nullable(),
      account_name: z.string().nullable(),
    }),
  ),
};

export type InvoiceSummary = z.infer<z.ZodObject<typeof invoiceSummaryOut>>;
export type InvoiceDetail = z.infer<z.ZodObject<typeof invoiceDetailOut>>;

export function mapInvoiceSummary(i: RawInvoiceSummary): InvoiceSummary {
  return {
    id: i.id,
    invoice_number: i.invoiceNumber,
    status: i.status,
    invoice_date: i.invoiceDate,
    due_date: i.dueDate,
    customer_id: i.customer.id,
    customer_name: i.customer.name,
    currency: i.currency.code,
    total: amount(i.total),
    amount_due: amount(i.amountDue),
    modified_at: i.modifiedAt,
  };
}

export function mapInvoiceDetail(i: RawInvoiceDetail): InvoiceDetail {
  return {
    ...mapInvoiceSummary(i),
    customer_email: i.customer.email ?? null,
    title: i.title ?? null,
    po_number: i.poNumber ?? null,
    memo: i.memo ?? null,
    footer: i.footer ?? null,
    pdf_url: i.pdfUrl,
    view_url: i.viewUrl,
    exchange_rate: String(i.exchangeRate),
    amount_paid: amount(i.amountPaid),
    tax_total: amount(i.taxTotal),
    items: (i.items ?? []).map((item) => ({
      product_id: item.product.id,
      product_name: item.product.name,
      description: item.description ?? null,
      quantity: String(item.quantity),
      unit_price: String(item.unitPrice),
      subtotal: amount(item.subtotal),
      total: amount(item.total),
      taxes: item.taxes.map((t) => ({
        sales_tax_id: t.salesTax.id,
        abbreviation: t.salesTax.abbreviation,
        rate: String(t.salesTax.rate),
        amount: t.amount ? amount(t.amount) : null,
      })),
    })),
    payments: (i.payments ?? [])
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => ({
        id: p.id,
        payment_date: p.paymentDate ?? null,
        amount: p.amount ?? null,
        payment_method: p.paymentMethod ?? null,
        memo: p.memo ?? null,
        account_id: p.account?.id ?? null,
        account_name: p.account?.name ?? null,
      })),
  };
}
