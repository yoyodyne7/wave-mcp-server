#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, listBusinesses } from "./client.js";
import { loadConfig, loadToken, resolveEnv } from "./config.js";
import { buildServer } from "./server.js";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));

async function main(): Promise<void> {
  const env = resolveEnv(process.env, existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : undefined);
  if (process.argv.includes("--list-businesses")) {
    for (const b of await listBusinesses(loadToken(env))) {
      console.log(`${b.id}\t${b.name}${b.isPersonal ? " (personal)" : ""}`);
    }
    return;
  }
  const server = buildServer(createClient(loadConfig(env)));
  await server.connect(new StdioServerTransport());
  console.error("wave-mcp-server running on stdio");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
