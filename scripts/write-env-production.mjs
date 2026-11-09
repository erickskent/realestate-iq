// Runs during the AWS Amplify build. Amplify console environment variables exist only while the build runs, so
// this copies the server-side ones the API route needs into .env.production, which Next.js loads at runtime.
// It writes only the variables listed below and never prints a value.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RUNTIME_ENV_VARS = ["ANTHROPIC_API_KEY", "RATE_LIMIT_STORE", "RATE_LIMIT_TABLE", "RATE_LIMIT_REGION"];

/**
 * Quotes a value so Next.js reads it back unchanged: single quotes, with "$" escaped because Next.js expands
 * "$NAME" references even inside single quotes. Values containing a single quote or line break can't be
 * represented safely and are rejected instead.
 * @param {string} value
 */
export function encodeEnvValue(value) {
  if (/['\r\n\0]/.test(value)) throw new Error("Value contains a quote or line break and can't be written safely.");
  return `'${value.replace(/\$/g, "\\$")}'`;
}

/**
 * Builds the .env.production contents from the allowed variables. Unset or empty variables are skipped.
 * @param {Record<string, string | undefined>} env
 */
export function buildEnvProduction(env) {
  const lines = [];
  /** @type {string[]} */ const written = [];
  /** @type {string[]} */ const skipped = [];
  /** @type {string[]} */ const rejected = [];

  for (const name of RUNTIME_ENV_VARS) {
    const value = env[name];
    if (value === undefined || value === "") {
      skipped.push(name);
      continue;
    }
    try {
      lines.push(`${name}=${encodeEnvValue(value)}`);
      written.push(name);
    } catch {
      rejected.push(name);
    }
  }
  return { content: lines.length ? `${lines.join("\n")}\n` : "", written, skipped, rejected };
}

/**
 * Writes .env.production in `dir` (replacing any existing file) and returns a summary listing variable names only.
 * @param {Record<string, string | undefined>} env
 * @param {string} dir
 */
export function writeEnvProduction(env, dir) {
  const result = buildEnvProduction(env);
  if (result.rejected.length > 0) {
    return { ok: false, message: `Not written: ${result.rejected.join(", ")} contain a quote or line break. Fix the value in the Amplify console.` };
  }
  writeFileSync(path.join(dir, ".env.production"), result.content, { mode: 0o600 });
  return {
    ok: true,
    message: `Wrote .env.production with: ${result.written.join(", ") || "(none)"}. Not set: ${result.skipped.join(", ") || "(none)"}.`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { ok, message } = writeEnvProduction(process.env, process.cwd());
  (ok ? console.log : console.error)(`[write-env-production] ${message}`);
  if (!ok) process.exit(1);
}
