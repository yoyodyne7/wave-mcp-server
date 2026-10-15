import { createHash } from "node:crypto";
import { WaveError } from "./errors.js";

export interface InvoiceSnapshot {
  id: string;
  status: string;
  total: string;
  amountDue: string;
  modifiedAt: string;
}

export type GateResult =
  | { proceed: true }
  | { proceed: false; reason: "preview" | "mismatch"; fingerprint: string };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fingerprint(
  tool: string,
  snapshot: InvoiceSnapshot,
  inputs: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(stable({ tool, snapshot, inputs }))
    .digest("hex")
    .slice(0, 16);
}

export function checkGate(args: {
  tool: string;
  snapshot: InvoiceSnapshot;
  inputs: Record<string, unknown>;
  confirm?: boolean;
  fingerprint?: string;
}): GateResult {
  const current = fingerprint(args.tool, args.snapshot, args.inputs);
  if (!args.confirm) return { proceed: false, reason: "preview", fingerprint: current };
  if (!args.fingerprint) {
    throw new WaveError(
      "CONFIRM_WITHOUT_PREVIEW",
      `confirm: true needs the fingerprint from a preview. Call ${args.tool} without confirm first, ` +
        "show the preview to the user, then call again with confirm: true and that fingerprint.",
    );
  }
  return args.fingerprint === current
    ? { proceed: true }
    : { proceed: false, reason: "mismatch", fingerprint: current };
}
