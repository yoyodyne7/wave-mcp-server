import { z } from "zod";
import { amount, type Money } from "../format.js";

const CUSTOMER_FIELDS = `
  id name firstName lastName email phone isArchived
  currency { code }
  address { addressLine1 addressLine2 city postalCode province { code name } country { code name } }
  outstandingAmount { value currency { code } }
  overdueAmount { value currency { code } }`;

export const LIST_CUSTOMERS = `query ListCustomers($businessId: ID!, $page: Int!, $pageSize: Int!, $email: String) {
  business(id: $businessId) {
    customers(page: $page, pageSize: $pageSize, sort: [NAME_ASC], email: $email) {
      pageInfo { currentPage totalPages totalCount }
      edges { node { ${CUSTOMER_FIELDS} } }
    }
  }
}`;

export const GET_CUSTOMER = `query GetCustomer($businessId: ID!, $customerId: ID!) {
  business(id: $businessId) { customer(id: $customerId) { ${CUSTOMER_FIELDS} } }
}`;

export const CREATE_CUSTOMER = `mutation CreateCustomer($input: CustomerCreateInput!) {
  customerCreate(input: $input) {
    didSucceed inputErrors { path message code } customer { ${CUSTOMER_FIELDS} }
  }
}`;

export const PATCH_CUSTOMER = `mutation PatchCustomer($input: CustomerPatchInput!) {
  customerPatch(input: $input) {
    didSucceed inputErrors { path message code } customer { ${CUSTOMER_FIELDS} }
  }
}`;

export interface RawCustomer {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  isArchived: boolean | null;
  currency: { code: string } | null;
  address: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    postalCode: string | null;
    province: { code: string; name: string } | null;
    country: { code: string; name: string } | null;
  } | null;
  outstandingAmount: Money;
  overdueAmount: Money;
}

export const customerOut = {
  id: z.string(),
  name: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  currency: z.string().nullable(),
  is_archived: z.boolean(),
  outstanding: z.string(),
  overdue: z.string(),
  address: z
    .object({
      line1: z.string().nullable(),
      line2: z.string().nullable(),
      city: z.string().nullable(),
      province: z.string().nullable(),
      country: z.string().nullable(),
      postal_code: z.string().nullable(),
    })
    .nullable(),
};

export type Customer = z.infer<z.ZodObject<typeof customerOut>>;

export function mapCustomer(c: RawCustomer): Customer {
  return {
    id: c.id,
    name: c.name,
    first_name: c.firstName ?? null,
    last_name: c.lastName ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    currency: c.currency?.code ?? null,
    is_archived: c.isArchived ?? false,
    outstanding: amount(c.outstandingAmount),
    overdue: amount(c.overdueAmount),
    address: c.address
      ? {
          line1: c.address.addressLine1 ?? null,
          line2: c.address.addressLine2 ?? null,
          city: c.address.city ?? null,
          province: c.address.province?.name ?? null,
          country: c.address.country?.code ?? null,
          postal_code: c.address.postalCode ?? null,
        }
      : null,
  };
}
