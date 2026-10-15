import { z } from "zod";

const TAX_FIELDS = `id name abbreviation rate isCompound isRecoverable`;
const PRODUCT_FIELDS = `id name description unitPrice isSold isArchived
  defaultSalesTaxes { ${TAX_FIELDS} } incomeAccount { id name }`;
const ACCOUNT_FIELDS = `id name isArchived currency { code } type { name value } subtype { name value }`;
const PAGE_INFO = `pageInfo { currentPage totalPages totalCount }`;

export const LIST_PRODUCTS = `query ListProducts($businessId: ID!, $page: Int!, $pageSize: Int!) {
  business(id: $businessId) {
    products(page: $page, pageSize: $pageSize, sort: [NAME_ASC], isSold: true, isArchived: false) {
      ${PAGE_INFO} edges { node { ${PRODUCT_FIELDS} } }
    }
  }
}`;

export const LIST_SALES_TAXES = `query ListSalesTaxes($businessId: ID!, $page: Int!, $pageSize: Int!) {
  business(id: $businessId) {
    salesTaxes(page: $page, pageSize: $pageSize, isArchived: false) {
      ${PAGE_INFO} edges { node { ${TAX_FIELDS} } }
    }
  }
}`;

export const LIST_ACCOUNTS = `query ListAccounts($businessId: ID!, $page: Int!, $pageSize: Int!, $types: [AccountTypeValue!], $subtypes: [AccountSubtypeValue!]) {
  business(id: $businessId) {
    accounts(page: $page, pageSize: $pageSize, types: $types, subtypes: $subtypes, isArchived: false) {
      ${PAGE_INFO} edges { node { ${ACCOUNT_FIELDS} } }
    }
  }
}`;

export const GET_ACCOUNT = `query GetAccount($businessId: ID!, $accountId: ID!) {
  business(id: $businessId) { account(id: $accountId) { ${ACCOUNT_FIELDS} } }
}`;

export const CREATE_PRODUCT = `mutation CreateProduct($input: ProductCreateInput!) {
  productCreate(input: $input) {
    didSucceed inputErrors { path message code } product { ${PRODUCT_FIELDS} }
  }
}`;

export interface RawSalesTax {
  id: string;
  name: string;
  abbreviation: string;
  rate: string | number;
  isCompound: boolean;
  isRecoverable: boolean;
}

export interface RawProduct {
  id: string;
  name: string;
  description: string | null;
  unitPrice: string | number;
  defaultSalesTaxes: RawSalesTax[];
  incomeAccount: { id: string; name: string } | null;
}

export interface RawAccount {
  id: string;
  name: string;
  isArchived: boolean;
  currency: { code: string };
  type: { name: string; value: string };
  subtype: { name: string; value: string };
}

export const salesTaxOut = {
  id: z.string(),
  name: z.string(),
  abbreviation: z.string(),
  rate: z.string().describe('Decimal fraction, e.g. "0.13" for 13%'),
  is_compound: z.boolean(),
  is_recoverable: z.boolean(),
};

export const productOut = {
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unit_price: z.string(),
  income_account_id: z.string().nullable(),
  income_account_name: z.string().nullable(),
  default_sales_taxes: z.array(z.object({ id: z.string(), abbreviation: z.string(), rate: z.string() })),
};

export const accountOut = {
  id: z.string(),
  name: z.string(),
  currency: z.string(),
  type: z.string(),
  subtype: z.string(),
  is_archived: z.boolean(),
};

export type SalesTax = z.infer<z.ZodObject<typeof salesTaxOut>>;
export type Product = z.infer<z.ZodObject<typeof productOut>>;
export type Account = z.infer<z.ZodObject<typeof accountOut>>;

export function mapSalesTax(t: RawSalesTax): SalesTax {
  return {
    id: t.id,
    name: t.name,
    abbreviation: t.abbreviation,
    rate: String(t.rate),
    is_compound: t.isCompound,
    is_recoverable: t.isRecoverable,
  };
}

export function mapProduct(p: RawProduct): Product {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    unit_price: String(p.unitPrice),
    income_account_id: p.incomeAccount?.id ?? null,
    income_account_name: p.incomeAccount?.name ?? null,
    default_sales_taxes: p.defaultSalesTaxes.map((t) => ({
      id: t.id,
      abbreviation: t.abbreviation,
      rate: String(t.rate),
    })),
  };
}

export function mapAccount(a: RawAccount): Account {
  return {
    id: a.id,
    name: a.name,
    currency: a.currency.code,
    type: a.type.value,
    subtype: a.subtype.value,
    is_archived: a.isArchived,
  };
}
