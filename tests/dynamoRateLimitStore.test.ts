import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConditionalCheckFailedException, type UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createDynamoClient, createDynamoRateLimitStore, isValidTableName, windowStart, type UpdateItemSender } from "../lib/dynamoRateLimitStore.ts";
import { AI_RATE_LIMITS, checkAiRateLimits } from "../lib/rateLimit.ts";
import { handleAnalyzeRequest } from "../lib/analyzeHandler.ts";
import { exampleInputs, VALID_ASSESSMENT } from "./helpers.ts";

/**
 * Stand-in for a DynamoDB table. Applies the store's conditional ADD the way DynamoDB does: the condition is checked
 * and the counter updated in one indivisible step per call. No network access.
 */
function fakeTable() {
  const items = new Map<string, { count: number; expiresAt: number }>();
  const commands: UpdateItemCommand["input"][] = [];
  const sender: UpdateItemSender = {
    async send(command) {
      const input = command.input;
      commands.push(input);
      const pk = input.Key!.pk.S!;
      const values = input.ExpressionAttributeValues!;
      const limit = Number(values[":limit"].N);
      const existing = items.get(pk);
      if (existing && !(existing.count < limit)) {
        throw new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });
      }
      items.set(pk, { count: (existing?.count ?? 0) + Number(values[":one"].N), expiresAt: existing?.expiresAt ?? Number(values[":expiresAt"].N) });
      return {};
    },
  };
  return { items, commands, sender };
}

const MINUTE = 60_000;

describe("createDynamoRateLimitStore", () => {
  it("sends one atomic, conditional UpdateItem with a window-specific key and an expiry", async () => {
    const table = fakeTable();
    const store = createDynamoRateLimitStore({ tableName: "realestate-iq-rate-limits", client: table.sender });
    await store.hit("client:abc", 5, 10 * MINUTE, 12 * MINUTE);

    const input = table.commands[0];
    assert.equal(input.TableName, "realestate-iq-rate-limits");
    assert.deepEqual(input.Key, { pk: { S: `client:abc#${10 * MINUTE}` } });
    assert.equal(input.UpdateExpression, "ADD #count :one SET #expiresAt = if_not_exists(#expiresAt, :expiresAt)");
    assert.equal(input.ConditionExpression, "attribute_not_exists(#count) OR #count < :limit");
    assert.deepEqual(input.ExpressionAttributeNames, { "#count": "count", "#expiresAt": "expiresAt" });
    assert.equal(input.ExpressionAttributeValues![":limit"].N, "5");
    // Window ends at 20 minutes; the item expires one hour after that (in Unix seconds).
    assert.equal(input.ExpressionAttributeValues![":expiresAt"].N, String((20 * MINUTE) / 1000 + 3600));
  });

  it("allows up to the limit in a window, then blocks until the window ends", async () => {
    const table = fakeTable();
    const store = createDynamoRateLimitStore({ tableName: "limits", client: table.sender });
    for (let i = 0; i < 3; i++) assert.deepEqual(await store.hit("k", 3, 10 * MINUTE, 1_000 + i), { allowed: true });
    assert.deepEqual(await store.hit("k", 3, 10 * MINUTE, 4 * MINUTE), { allowed: false, retryAfterSeconds: 360 });
    assert.equal(table.items.get("k#0")!.count, 3, "rejected requests don't increase the count");
    assert.equal((await store.hit("k", 3, 10 * MINUTE, 10 * MINUTE)).allowed, true, "a new window starts fresh");
  });

  it("keeps separate counts per key", async () => {
    const table = fakeTable();
    const store = createDynamoRateLimitStore({ tableName: "limits", client: table.sender });
    assert.equal((await store.hit("a", 1, MINUTE, 0)).allowed, true);
    assert.equal((await store.hit("a", 1, MINUTE, 1)).allowed, false);
    assert.equal((await store.hit("b", 1, MINUTE, 1)).allowed, true);
  });

  it("never lets simultaneous requests from several server instances exceed the limit", async () => {
    const table = fakeTable();
    const instances = [1, 2, 3].map(() => createDynamoRateLimitStore({ tableName: "limits", client: table.sender }));
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => instances[i % 3].hit("daily", 5, 86_400_000, 1_000)));
    assert.equal(results.filter((r) => r.allowed).length, 5);
  });

  it("re-throws errors other than a full window, so the caller fails closed", async () => {
    const failing: UpdateItemSender = { send: async () => { throw Object.assign(new Error("AccessDenied"), { name: "AccessDeniedException" }); } };
    const store = createDynamoRateLimitStore({ tableName: "limits", client: failing });
    await assert.rejects(store.hit("k", 5, MINUTE, 0), /AccessDenied/);
    await assert.rejects(checkAiRateLimits(store, { kind: "unverified", reason: "test" }, 0));
  });

  it("enforces the global daily cap across instances when used through checkAiRateLimits", async () => {
    const table = fakeTable();
    const a = createDynamoRateLimitStore({ tableName: "limits", client: table.sender });
    const b = createDynamoRateLimitStore({ tableName: "limits", client: table.sender });
    let allowed = 0;
    for (let i = 0; i < AI_RATE_LIMITS.daily.limit + 10; i++) {
      const identity = { kind: "ip" as const, ip: `10.1.${Math.floor(i / 200)}.${i % 200}` };
      if ((await checkAiRateLimits(i % 2 ? a : b, identity, 1_000 + i)).allowed) allowed++;
    }
    assert.equal(allowed, AI_RATE_LIMITS.daily.limit);
  });

  it("declares itself shared across instances", () => {
    assert.equal(createDynamoRateLimitStore({ tableName: "limits", client: fakeTable().sender }).sharedAcrossInstances, true);
  });

  it("rejects invalid table names", () => {
    assert.throws(() => createDynamoRateLimitStore({ tableName: "a b", client: fakeTable().sender }));
  });
});

describe("helpers", () => {
  it("validates DynamoDB table names", () => {
    for (const name of ["abc", "realestate-iq-rate-limits", "my_table.v2"]) assert.ok(isValidTableName(name), name);
    for (const name of ["", "ab", "has space", "semi;colon", "a".repeat(256)]) assert.ok(!isValidTableName(name), name);
  });

  it("aligns daily windows to midnight UTC", () => {
    const now = Date.UTC(2026, 10, 9, 15, 30);
    assert.equal(windowStart(now, 86_400_000), Date.UTC(2026, 10, 9));
  });

  it("builds a real client with the requested region without contacting AWS", async () => {
    const client = createDynamoClient("us-east-1");
    assert.equal(await client.config.region(), "us-east-1");
    client.destroy();
  });
});

describe("analyze route behavior with the DynamoDB store", () => {
  const run = (sender: UpdateItemSender, calls: unknown[]) =>
    handleAnalyzeRequest({
      apiKeyConfigured: true,
      bodyText: JSON.stringify({ inputs: exampleInputs() }),
      identity: { kind: "ip", ip: "203.0.113.5" },
      rateLimitStore: createDynamoRateLimitStore({ tableName: "realestate-iq-rate-limits", client: sender }),
      callModel: async (facts) => (calls.push(facts), { kind: "ok", text: JSON.stringify(VALID_ASSESSMENT), model: "test" }),
    });

  // Error names the AWS SDK uses for common setup and outage problems.
  for (const name of ["ResourceNotFoundException", "AccessDeniedException", "CredentialsProviderError", "ProvisionedThroughputExceededException", "ThrottlingException", "TimeoutError", "InternalServerError"]) {
    it(`fails closed on ${name} without calling the model`, async () => {
      const calls: unknown[] = [];
      const failing: UpdateItemSender = { send: async () => { throw Object.assign(new Error("simulated"), { name }); } };
      const original = console.error;
      const logged: string[] = [];
      console.error = (message: string) => void logged.push(message);
      try {
        const result = await run(failing, calls);
        assert.equal(result.status, 503);
        assert.equal(!result.body.ok && result.body.error, "rate_limit_unavailable");
      } finally {
        console.error = original;
      }
      assert.equal(calls.length, 0);
      assert.deepEqual(logged, [`[analyze] Rate-limit store "dynamodb" failed: ${name}`]);
    });
  }

  it("calls the model when DynamoDB accepts the update, and returns 429 once the per-IP limit is reached", async () => {
    const table = fakeTable();
    const calls: unknown[] = [];
    for (let i = 0; i < AI_RATE_LIMITS.perClient.limit; i++) assert.equal((await run(table.sender, calls)).status, 200);
    assert.equal((await run(table.sender, calls)).status, 429);
    assert.equal(calls.length, AI_RATE_LIMITS.perClient.limit);
    assert.ok([...table.items.keys()].every((pk) => !pk.includes("203.0.113.5")), "raw IP never written to the table");
  });
});
