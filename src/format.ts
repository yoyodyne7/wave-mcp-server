export interface PageInfo {
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

export interface Connection<T> {
  pageInfo: PageInfo;
  edges: { node: T }[];
}

// A type alias, not an interface: tool results are passed as Record<string, unknown>,
// and only aliases get the implicit index signature that makes that assignment legal.
export type Page<T> = {
  items: T[];
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  has_more: boolean;
};

export function pageEnvelope<T>(items: T[], info: PageInfo, pageSize: number): Page<T> {
  return {
    items,
    page: info.currentPage,
    page_size: pageSize,
    total_count: info.totalCount,
    total_pages: info.totalPages,
    has_more: info.currentPage < info.totalPages,
  };
}

export interface Money {
  value: string;
  currency: { code: string };
}

/** Wave formats Money.value for display; strip thousands separators to get a plain decimal. */
export function amount(m: Money): string {
  return m.value.replace(/,/g, "");
}

const SCALE = 5;

/** Parse a plain decimal string into an integer scaled by 10^5. Throws on anything else. */
export function toScaled(decimal: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,5}))?$/.exec(decimal);
  if (!match) throw new Error(`Not a plain decimal: "${decimal}"`);
  const [, sign, whole, fraction = ""] = match;
  const scaled = BigInt(whole + fraction.padEnd(SCALE, "0"));
  return sign ? -scaled : scaled;
}

function fromScaled(n: bigint): string {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(SCALE + 1, "0");
  const whole = digits.slice(0, -SCALE);
  let fraction = digits.slice(-SCALE).replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const diff = toScaled(a) - toScaled(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

export function subtractDecimal(a: string, b: string): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}

/** Latest acceptable payment date: one day ahead of UTC now, to allow for any timezone. */
export function latestPaymentDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function asText(summary: string, data: unknown): string {
  return `${summary}\n\n${JSON.stringify(data, null, 2)}`;
}
