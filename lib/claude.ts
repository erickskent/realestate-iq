import Anthropic from "@anthropic-ai/sdk";
import { AI_LIMITS, ASSESSMENT_SCHEMA, buildUserMessage, SYSTEM_PROMPT } from "./aiAnalysis.ts";
import type { ModelCaller } from "./analyzeHandler.ts";

// Server-only: this file reads no environment variables itself and is imported only by the API route.

export const AI_MODEL = "claude-sonnet-5-5";

export function createClaudeCaller(apiKey: string): ModelCaller {
  const client = new Anthropic({ apiKey, timeout: AI_LIMITS.timeoutMs, maxRetries: 0 });

  return async (factSheet) => {
    try {
      const response = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: AI_LIMITS.maxOutputTokens,
        // If a safety classifier declines, Anthropic retries on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: ASSESSMENT_SCHEMA } },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(factSheet) }],
      });

      if (response.stop_reason === "refusal") return { kind: "refused" };
      if (response.stop_reason === "max_tokens") return { kind: "truncated" };

      // Only read the answer from the model that finished the turn (after any fallback switch).
      const lastFallback = response.content.findLastIndex((block) => block.type === "fallback");
      const text = response.content
        .slice(lastFallback + 1)
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      return { kind: "ok", text, model: response.model };
    } catch (error) {
      // Log only the error type and status, never the request contents or the key.
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      console.error(`[analyze] Claude request failed: ${error instanceof Error ? error.name : "unknown"}${status ? ` (${status})` : ""}`);

      if (error instanceof Anthropic.APIConnectionTimeoutError) return { kind: "timeout" };
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return { kind: "auth_failed" };
      if (error instanceof Anthropic.RateLimitError) return { kind: "rate_limited" };
      return { kind: "unavailable" };
    }
  };
}
