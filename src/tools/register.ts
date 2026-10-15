import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { WaveClient } from "../client.js";
import { toToolError } from "../errors.js";

export type Kind = "read" | "write" | "gated";

export interface ToolResult {
  text: string;
  data: Record<string, unknown>;
}

export interface ToolDef<I extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  kind: Kind;
  inputSchema: I;
  outputSchema: z.ZodRawShape;
  handler: (client: WaveClient, args: z.infer<z.ZodObject<I>>) => Promise<ToolResult>;
}

const ANNOTATIONS: Record<Kind, Record<string, boolean>> = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  gated: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};

export function registerTool<I extends z.ZodRawShape>(
  server: McpServer,
  client: WaveClient,
  def: ToolDef<I>,
): void {
  // The SDK's callback generics do not compose with a generic wrapper; the Zod schema has
  // already validated `args` by the time this runs, so the casts are safe.
  const callback = async (args: unknown) => {
    try {
      const result = await def.handler(client, args as z.infer<z.ZodObject<I>>);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.data,
      };
    } catch (e) {
      return toToolError(e);
    }
  };
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      annotations: ANNOTATIONS[def.kind],
    },
    callback as never,
  );
}
