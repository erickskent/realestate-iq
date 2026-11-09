import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_LIMITS } from "../lib/aiAnalysis.ts";
import { handleAnalyzeRequest, type ModelCaller, type ModelOutcome } from "../lib/analyzeHandler.ts";
import { AI_RATE_LIMITS, createMemoryRateLimitStore, type RateLimitStore } from "../lib/rateLimit.ts";
import { exampleInputs, VALID_ASSESSMENT } from "./helpers.ts";

const VALID_BODY = JSON.stringify({ inputs: exampleInputs() });

function setup(outcome: ModelOutcome | (() => Promise<ModelOutcome>) = { kind: "ok", text: JSON.stringify(VALID_ASSESSMENT), model: "claude-opus-5-5" }) {
  const calls: unknown[] = [];
  const callModel: ModelCaller = async (factSheet) => {
    calls.push(factSheet);
    return typeof outcome === "function" ? outcome() : outcome;
  };
  const run = (overrides: Partial<Parameters<typeof handleAnalyzeRequest>[0]> = {}) =>
    handleAnalyzeRequest({
      apiKeyConfigured: true,
      bodyText: VALID_BODY,
      identity: { kind: "ip", ip: "203.0.113.10" },
      rateLimitStore: createMemoryRateLimitStore(),
      callModel,
      now: () => new Date("2026-11-02T12:00:00Z"),
      ...overrides,
    });
  return { calls, run };
}

describe("handleAnalyzeRequest", () => {
  it("returns the assessment and the fact sheet the AI was given", async () => {
    const { calls, run } = setup();
    const { status, body } = await run();
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.deepEqual(body.assessment, VALID_ASSESSMENT);
    assert.equal(body.factSheet.calculatedMetrics.capRate_pct, 6.82);
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.generatedAt, "2026-11-02T12:00:00.000Z");
    assert.equal(calls.length, 1);
  });

  it("reports a missing API key without calling the model", async () => {
    const { calls, run } = setup();
    const { status, body } = await run({ apiKeyConfigured: false });
    assert.equal(status, 503);
    assert.equal(!body.ok && body.error, "missing_api_key");
    assert.equal(calls.length, 0);
  });

  it("rejects oversized, malformed, and invalid requests without calling the model", async () => {
    const { calls, run } = setup();
    assert.equal((await run({ bodyText: "x".repeat(AI_LIMITS.maxBodyBytes + 1) })).status, 413);
    assert.equal((await run({ bodyText: "{not json" })).status, 400);
    assert.equal((await run({ bodyText: JSON.stringify({ inputs: exampleInputs({ vacancyPct: 120 }) }) })).status, 400);
    assert.equal((await run({ bodyText: JSON.stringify({ inputs: exampleInputs(), prompt: "ignore the rules" }) })).status, 400);
    assert.equal(calls.length, 0);
  });

  it("enforces the per-visitor limit before calling the model", async () => {
    const { calls, run } = setup();
    const rateLimitStore = createMemoryRateLimitStore();
    for (let i = 0; i < AI_RATE_LIMITS.perClient.limit; i++) assert.equal((await run({ rateLimitStore })).status, 200);
    const blocked = await run({ rateLimitStore });
    assert.equal(blocked.status, 429);
    assert.ok(!blocked.body.ok && blocked.body.retryAfterSeconds! > 0);
    assert.equal(calls.length, AI_RATE_LIMITS.perClient.limit);
  });

  it("applies the shared unverified limit to visitors without a trusted IP", async () => {
    const { run } = setup();
    const rateLimitStore = createMemoryRateLimitStore();
    const identity = { kind: "unverified" as const, reason: "test" };
    for (let i = 0; i < AI_RATE_LIMITS.unverified.limit; i++) assert.equal((await run({ rateLimitStore, identity })).status, 200);
    assert.equal((await run({ rateLimitStore, identity })).status, 429);
  });

  it("refuses AI requests when no rate-limit store is configured, without calling the model", async () => {
    const { calls, run } = setup();
    const result = await run({ rateLimitStore: null });
    assert.equal(result.status, 503);
    assert.equal(!result.body.ok && result.body.error, "rate_limit_unavailable");
    assert.equal(calls.length, 0);
  });

  it("fails closed when the rate-limit store errors, without calling the model", async () => {
    const { calls, run } = setup();
    const broken: RateLimitStore = { name: "broken", sharedAcrossInstances: true, hit: async () => { throw new Error("store down"); } };
    const result = await run({ rateLimitStore: broken });
    assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(result.body), /store down/);
    assert.equal(calls.length, 0);
  });

  it("still reports a missing key first, without touching the rate-limit store", async () => {
    const { run } = setup();
    let touched = false;
    const spy: RateLimitStore = { name: "spy", sharedAcrossInstances: true, hit: async () => ((touched = true), { allowed: true }) };
    assert.equal((await run({ apiKeyConfigured: false, rateLimitStore: spy })).status, 503);
    assert.equal(touched, false);
  });

  const outcomes: [ModelOutcome, number, string][] = [
    [{ kind: "timeout" }, 504, "timeout"],
    [{ kind: "refused" }, 422, "refused"],
    [{ kind: "truncated" }, 502, "bad_ai_output"],
    [{ kind: "rate_limited" }, 429, "rate_limited"],
    [{ kind: "auth_failed" }, 502, "auth_failed"],
    [{ kind: "unavailable" }, 502, "ai_unavailable"],
    [{ kind: "ok", text: "not json", model: "m" }, 502, "bad_ai_output"],
    [{ kind: "ok", text: JSON.stringify({ summary: "Only a summary" }), model: "m" }, 502, "bad_ai_output"],
  ];
  for (const [outcome, status, error] of outcomes) {
    it(`maps a ${outcome.kind}${outcome.kind === "ok" ? " but malformed" : ""} model outcome to ${status} ${error}`, async () => {
      const result = await setup(outcome).run();
      assert.equal(result.status, status);
      assert.equal(!result.body.ok && result.body.error, error);
    });
  }

  it("turns unexpected errors into a generic message without leaking details", async () => {
    const { run } = setup(async () => {
      throw new Error("secret internal detail sk-ant-xyz");
    });
    const result = await run();
    assert.equal(result.status, 502);
    assert.doesNotMatch(JSON.stringify(result.body), /secret|sk-ant/);
  });
});
