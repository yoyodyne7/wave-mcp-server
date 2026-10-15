import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WaveClient } from "../client.js";
import { WaveError, assertSucceeded, notFound, requireBusiness, type MutationPayload } from "../errors.js";
import { asText, pageEnvelope, type Connection } from "../format.js";
import {
  CREATE_PRODUCT,
  GET_ACCOUNT,
  LIST_ACCOUNTS,
  LIST_PRODUCTS,
  LIST_SALES_TAXES,
  accountOut,
  mapAccount,
  mapProduct,
  mapSalesTax,
  productOut,
  salesTaxOut,
  type Account,
  type RawAccount,
  type RawProduct,
  type RawSalesTax,
} from "../queries/catalog.js";
import { decimal, id, pageOutput, paging } from "../schemas.js";
import { registerTool, type ToolResult } from "./register.js";

interface PageArgs {
  page: number;
  page_size: number;
}

export async function listProducts(client: WaveClient, args: PageArgs): Promise<ToolResult> {
  const res = await client.query<{ business: { products: Connection<RawProduct> } | null }>(LIST_PRODUCTS, {
    page: args.page,
    pageSize: args.page_size,
  });
  const connection = requireBusiness(res.business).products;
  const data = pageEnvelope(connection.edges.map((e) => mapProduct(e.node)), connection.pageInfo, args.page_size);
  return { text: asText(`${data.total_count} product(s)/service(s).`, data), data };
}

export async function listSalesTaxes(client: WaveClient, args: PageArgs): Promise<ToolResult> {
  const res = await client.query<{ business: { salesTaxes: Connection<RawSalesTax> } | null }>(LIST_SALES_TAXES, {
    page: args.page,
    pageSize: args.page_size,
  });
  const connection = requireBusiness(res.business).salesTaxes;
  const data = pageEnvelope(connection.edges.map((e) => mapSalesTax(e.node)), connection.pageInfo, args.page_size);
  return { text: asText(`${data.total_count} sales tax(es).`, data), data };
}

export async function listAccounts(
  client: WaveClient,
  args: PageArgs & { types?: string[]; subtypes?: string[] },
): Promise<ToolResult> {
  const res = await client.query<{ business: { accounts: Connection<RawAccount> } | null }>(LIST_ACCOUNTS, {
    page: args.page,
    pageSize: args.page_size,
    types: args.types,
    subtypes: args.subtypes,
  });
  const connection = requireBusiness(res.business).accounts;
  const data = pageEnvelope(connection.edges.map((e) => mapAccount(e.node)), connection.pageInfo, args.page_size);
  return { text: asText(`${data.total_count} account(s).`, data), data };
}

export async function fetchAccount(client: WaveClient, accountId: string): Promise<Account> {
  const res = await client.query<{ business: { account: RawAccount | null } | null }>(GET_ACCOUNT, { accountId });
  const account = requireBusiness(res.business).account;
  if (!account) throw notFound("account", accountId, "wave_list_accounts");
  return mapAccount(account);
}

export async function createProduct(
  client: WaveClient,
  args: {
    name: string;
    unit_price: string;
    description?: string;
    income_account_id?: string;
    default_sales_tax_ids?: string[];
  },
): Promise<ToolResult> {
  const input: Record<string, unknown> = { businessId: client.businessId, name: args.name, unitPrice: args.unit_price };
  if (args.description !== undefined) input.description = args.description;
  if (args.income_account_id !== undefined) {
    await fetchAccount(client, args.income_account_id);
    input.incomeAccountId = args.income_account_id;
  }
  if (args.default_sales_tax_ids !== undefined) input.defaultSalesTaxIds = args.default_sales_tax_ids;
  const res = await client.mutate<{ productCreate: MutationPayload & { product: RawProduct | null } }>(
    CREATE_PRODUCT,
    input,
  );
  assertSucceeded("create the product", res.productCreate);
  if (!res.productCreate.product) {
    throw new WaveError("BAD_RESPONSE", "Wave reported success but returned no product.");
  }
  const product = mapProduct(res.productCreate.product);
  return { text: asText(`Product "${product.name}" created.`, product), data: product };
}

export function registerCatalogTools(server: McpServer, client: WaveClient): void {
  registerTool(server, client, {
    name: "wave_list_products",
    title: "List Wave products and services",
    description:
      "List the products/services the business sells (unarchived), sorted by name. Each invoice line item " +
      "needs a product id from here. Shows unit price, income account and default sales taxes.",
    kind: "read",
    inputSchema: { ...paging },
    outputSchema: pageOutput(z.object(productOut)),
    handler: listProducts,
  });

  registerTool(server, client, {
    name: "wave_list_sales_taxes",
    title: "List Wave sales taxes",
    description:
      "List the business's sales taxes (e.g. HST) with ids and current rates. Use the ids in " +
      "wave_create_invoice line items (`sales_tax_ids`).",
    kind: "read",
    inputSchema: { ...paging },
    outputSchema: pageOutput(z.object(salesTaxOut)),
    handler: listSalesTaxes,
  });

  registerTool(server, client, {
    name: "wave_list_accounts",
    title: "List Wave accounts",
    description:
      "List chart-of-accounts entries (unarchived). Filter by `types` and/or `subtypes`. " +
      'For the deposit account in wave_record_payment use subtypes ["CASH_AND_BANK"]. ' +
      'For a product\'s income account use subtypes ["INCOME"].',
    kind: "read",
    inputSchema: {
      types: z.array(z.enum(["ASSET", "EQUITY", "EXPENSE", "INCOME", "LIABILITY"])).optional(),
      subtypes: z
        .array(z.string().regex(/^[A-Z_]+$/, "Use Wave subtype values such as CASH_AND_BANK or INCOME"))
        .optional(),
      ...paging,
    },
    outputSchema: pageOutput(z.object(accountOut)),
    handler: listAccounts,
  });

  registerTool(server, client, {
    name: "wave_create_product",
    title: "Create Wave product or service",
    description:
      "Create a product/service that can be used on invoice line items. Check wave_list_products first. " +
      "`income_account_id` must be an account of subtype INCOME, DISCOUNTS or OTHER_INCOME.",
    kind: "write",
    inputSchema: {
      name: z.string().min(1),
      unit_price: decimal.describe('Default price per unit as a decimal string, e.g. "5000.00"'),
      description: z.string().optional(),
      income_account_id: id("Income account").optional(),
      default_sales_tax_ids: z.array(id("Sales tax")).optional().describe("Taxes applied by default on invoices"),
    },
    outputSchema: productOut,
    handler: createProduct,
  });
}
