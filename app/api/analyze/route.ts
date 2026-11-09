import { NextResponse } from "next/server";
import { AI_LIMITS } from "@/lib/aiAnalysis";
import { handleAnalyzeRequest, type AnalyzeFailure } from "@/lib/analyzeHandler";
import { createClaudeCaller } from "@/lib/claude";
import { parseTrustedProxyHops, resolveClientIdentity } from "@/lib/clientIdentity";
import { createDynamoClient, createDynamoRateLimitStore } from "@/lib/dynamoRateLimitStore";
import { createMemoryRateLimitStore, selectRateLimitStore } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chosen once per server instance. In production this refuses to fall back to in-memory limits.
const storeSelection = selectRateLimitStore(process.env, {
  memory: () => createMemoryRateLimitStore(),
  dynamodb: (tableName, region) => createDynamoRateLimitStore({ tableName, client: createDynamoClient(region) }),
});
if (storeSelection.ok && storeSelection.warning) console.warn(`[analyze] ${storeSelection.warning}`);
if (!storeSelection.ok) console.warn(`[analyze] AI requests disabled: ${storeSelection.reason}`);

// Set only after verifying how many proxies in front of the app append to X-Forwarded-For.
const trustedProxyHops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);

function apiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

/** Lets the page show whether AI analysis is available. Never returns the key or any configuration values. */
export async function GET() {
  const reason = apiKey() === null ? "missing_api_key" : !storeSelection.ok ? "rate_limit_unavailable" : null;
  return NextResponse.json({ configured: reason === null, reason }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const key = apiKey();

  // Refuse oversized bodies before reading them. The handler re-checks the actual size.
  if (Number(request.headers.get("content-length") ?? 0) > AI_LIMITS.maxBodyBytes) {
    return NextResponse.json(
      { ok: false, error: "payload_too_large", message: "The request is larger than expected." } satisfies AnalyzeFailure,
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }
  const bodyText = await request.text();

  const { status, body } = await handleAnalyzeRequest({
    apiKeyConfigured: key !== null,
    bodyText,
    // Used only to pick a rate-limit bucket; the address is hashed before storage and never logged.
    identity: resolveClientIdentity(request.headers, trustedProxyHops),
    rateLimitStore: storeSelection.ok ? storeSelection.store : null,
    callModel: (factSheet) => createClaudeCaller(key!)(factSheet),
  });

  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (!body.ok && body.retryAfterSeconds) headers["Retry-After"] = String(body.retryAfterSeconds);
  return NextResponse.json(body, { status, headers });
}
