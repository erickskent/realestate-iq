import { AI_LIMITS, buildFactSheet, parseAssessment, validateAnalyzePayload, type AiAssessment, type FactSheet } from "./aiAnalysis.ts";
import type { ClientIdentity } from "./clientIdentity.ts";
import { checkAiRateLimits, type RateLimitStore } from "./rateLimit.ts";

/** What the Claude call reports back. Errors are already classified, so this file never touches the SDK. */
export type ModelOutcome =
  | { kind: "ok"; text: string; model: string }
  | { kind: "refused" }
  | { kind: "truncated" }
  | { kind: "timeout" }
  | { kind: "rate_limited" }
  | { kind: "auth_failed" }
  | { kind: "unavailable" };

export type ModelCaller = (factSheet: FactSheet) => Promise<ModelOutcome>;

export type AnalyzeErrorCode =
  | "missing_api_key"
  | "payload_too_large"
  | "invalid_request"
  | "rate_limited"
  | "rate_limit_unavailable"
  | "timeout"
  | "refused"
  | "bad_ai_output"
  | "auth_failed"
  | "ai_unavailable";

export type AnalyzeSuccess = { ok: true; assessment: AiAssessment; factSheet: FactSheet; model: string; generatedAt: string };
export type AnalyzeFailure = { ok: false; error: AnalyzeErrorCode; message: string; retryAfterSeconds?: number };
export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure;

const fail = (status: number, error: AnalyzeErrorCode, message: string, retryAfterSeconds?: number) => ({
  status,
  body: { ok: false, error, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } as AnalyzeFailure,
});

const OUTCOME_ERRORS: Record<Exclude<ModelOutcome["kind"], "ok">, { status: number; error: AnalyzeErrorCode; message: string }> = {
  refused: { status: 422, error: "refused", message: "Claude declined to analyze this request. The calculator results above are unaffected." },
  truncated: { status: 502, error: "bad_ai_output", message: "The AI response was cut off before it finished. Please try again." },
  timeout: { status: 504, error: "timeout", message: "The AI analysis took too long and was stopped. Please try again in a moment." },
  rate_limited: { status: 429, error: "rate_limited", message: "The AI service is busy right now. Please wait a minute and try again." },
  auth_failed: { status: 502, error: "auth_failed", message: "The server's Anthropic API key was rejected. The site owner needs to check it." },
  unavailable: { status: 502, error: "ai_unavailable", message: "The AI service couldn't complete the analysis. Please try again later." },
};

const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "AI analysis is unavailable because its request-limit service isn't configured or reachable. Everything else on the page still works.";

const LIMIT_MESSAGES = {
  client: { status: 429, message: "You've reached the limit for AI analyses. Please wait before trying again." },
  unverified: { status: 429, message: "AI analysis is busy right now. Please wait a few minutes before trying again." },
  daily: { status: 429, message: "The daily limit for AI analyses has been reached. Please try again later." },
} as const;

export async function handleAnalyzeRequest({
  apiKeyConfigured,
  bodyText,
  identity,
  rateLimitStore,
  callModel,
  now = () => new Date(),
}: {
  apiKeyConfigured: boolean;
  bodyText: string;
  identity: ClientIdentity;
  /** Null when no acceptable store is configured; AI requests are then refused rather than left unlimited. */
  rateLimitStore: RateLimitStore | null;
  callModel: ModelCaller;
  now?: () => Date;
}): Promise<{ status: number; body: AnalyzeResponse }> {
  if (!apiKeyConfigured) {
    return fail(503, "missing_api_key", "AI analysis isn't set up on this server yet. An ANTHROPIC_API_KEY needs to be added.");
  }

  if (new TextEncoder().encode(bodyText).length > AI_LIMITS.maxBodyBytes) {
    return fail(413, "payload_too_large", "The request is larger than expected.");
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return fail(400, "invalid_request", "The request body isn't valid JSON.");
  }

  const payload = validateAnalyzePayload(body);
  if (!payload.ok) return fail(400, "invalid_request", payload.message);

  // Fail closed: without working rate limits, the model is never called.
  if (!rateLimitStore) return fail(503, "rate_limit_unavailable", RATE_LIMIT_UNAVAILABLE_MESSAGE);
  let limits;
  try {
    limits = await checkAiRateLimits(rateLimitStore, identity, now().getTime());
  } catch (error) {
    // Log only the error type (e.g. AccessDeniedException, ResourceNotFoundException), never request data.
    console.error(`[analyze] Rate-limit store "${rateLimitStore.name}" failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return fail(503, "rate_limit_unavailable", RATE_LIMIT_UNAVAILABLE_MESSAGE);
  }
  if (!limits.allowed) {
    const { status, message } = LIMIT_MESSAGES[limits.scope];
    return fail(status, "rate_limited", message, limits.retryAfterSeconds);
  }

  const factSheet = buildFactSheet(payload.inputs);

  let outcome: ModelOutcome;
  try {
    outcome = await callModel(factSheet);
  } catch {
    outcome = { kind: "unavailable" };
  }

  if (outcome.kind !== "ok") {
    const { status, error, message } = OUTCOME_ERRORS[outcome.kind];
    return fail(status, error, message);
  }

  const assessment = parseAssessment(outcome.text);
  if (!assessment) {
    return fail(502, "bad_ai_output", "The AI returned an answer in an unexpected format. Please try again.");
  }

  return { status: 200, body: { ok: true, assessment, factSheet, model: outcome.model, generatedAt: now().toISOString() } };
}
