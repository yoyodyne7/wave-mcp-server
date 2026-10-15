export interface Config {
  token: string;
  businessId: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

const HELP: Record<string, string> = {
  WAVE_ACCESS_TOKEN:
    "WAVE_ACCESS_TOKEN: create a Full Access Token in the Wave developer portal " +
    "(https://developer.waveapps.com -> Manage Applications -> your app -> Create token).",
  WAVE_BUSINESS_ID:
    "WAVE_BUSINESS_ID: run `npx -y @sdnly/wave-mcp-server --list-businesses` (or `node dist/index.js --list-businesses` from a clone) and copy the id of the business to use.",
};

/** Use the .env file's values; refuse to start if the shell sets a different one. */
export function resolveEnv(processEnv: Env, fileEnv: Env | undefined): Env {
  if (!fileEnv) return processEnv;
  const resolved: Env = { ...processEnv };
  for (const name of Object.keys(HELP)) {
    const fromFile = read(fileEnv, name);
    const fromProcess = read(processEnv, name);
    if (fromFile && fromProcess && fromFile !== fromProcess) {
      throw new ConfigError(
        `${name} is set both in .env (next to this package) and in the environment this server was started with, and the two ` +
          "values differ. Remove one so it is clear which is in use.",
      );
    }
    resolved[name] = fromFile ?? fromProcess;
  }
  return resolved;
}

function requireCleanToken(token: string): string {
  if (!/^[\x21-\x7E]+$/.test(token)) {
    throw new ConfigError(
      "WAVE_ACCESS_TOKEN contains spaces, line breaks or other characters a token cannot have. " +
        "Paste it again into .env on a single line with no quotes.",
    );
  }
  return token;
}

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function fail(missing: string[]): never {
  throw new ConfigError(
    `Missing configuration. Pass these as environment variables (claude mcp add -e NAME=value), or, in a clone, copy .env.example to .env and fill it in:\n` +
      missing.map((name) => `- ${HELP[name]}`).join("\n"),
  );
}

export function loadToken(env: Env): string {
  const token = read(env, "WAVE_ACCESS_TOKEN");
  if (!token) fail(["WAVE_ACCESS_TOKEN"]);
  return requireCleanToken(token);
}

export function loadConfig(env: Env): Config {
  const token = read(env, "WAVE_ACCESS_TOKEN");
  const businessId = read(env, "WAVE_BUSINESS_ID");
  const missing = [
    ...(token ? [] : ["WAVE_ACCESS_TOKEN"]),
    ...(businessId ? [] : ["WAVE_BUSINESS_ID"]),
  ];
  if (!token || !businessId) fail(missing);
  return { token: requireCleanToken(token), businessId };
}
