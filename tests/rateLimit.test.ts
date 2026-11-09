import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_RATE_LIMITS, checkAiRateLimits, createMemoryRateLimitStore, selectRateLimitStore, type RateLimitStore } from "../lib/rateLimit.ts";
import { resolveClientIdentity } from "../lib/clientIdentity.ts";

const ip = (address: string) => ({ kind: "ip" as const, ip: address });
const unverified = { kind: "unverified" as const, reason: "test" };

describe("createMemoryRateLimitStore", () => {
  it("allows up to the limit within the window, then blocks with a retry time", async () => {
    const store = createMemoryRateLimitStore();
    for (let i = 0; i < 3; i++) assert.deepEqual(await store.hit("a", 3, 60_000, 1_000 + i), { allowed: true });
    assert.deepEqual(await store.hit("a", 3, 60_000, 2_000), { allowed: false, retryAfterSeconds: 59 });
  });

  it("allows requests again once old ones leave the window", async () => {
    const store = createMemoryRateLimitStore();
    assert.equal((await store.hit("a", 1, 60_000, 0)).allowed, true);
    assert.equal((await store.hit("a", 1, 60_000, 59_999)).allowed, false);
    assert.equal((await store.hit("a", 1, 60_000, 60_000)).allowed, true);
  });

  it("counts each key separately and keeps memory bounded", async () => {
    const store = createMemoryRateLimitStore({ maxKeys: 2 });
    await store.hit("a", 1, 60_000, 0);
    await store.hit("b", 1, 60_000, 0);
    assert.equal((await store.hit("b", 1, 60_000, 1)).allowed, false);
    await store.hit("c", 1, 60_000, 0);
    assert.equal((await store.hit("a", 1, 60_000, 1)).allowed, true, "a was evicted, so it starts fresh");
  });

  it("declares itself not shared across instances", () => {
    assert.equal(createMemoryRateLimitStore().sharedAcrossInstances, false);
  });
});

describe("selectRateLimitStore", () => {
  const dynamoCalls: [string, string | undefined][] = [];
  const factories = {
    memory: () => createMemoryRateLimitStore(),
    dynamodb: (table: string, region: string | undefined): RateLimitStore => {
      dynamoCalls.push([table, region]);
      return { name: "dynamodb", sharedAcrossInstances: true, hit: async () => ({ allowed: true }) };
    },
  };

  it("refuses to run in production without an explicit store", () => {
    assert.equal(selectRateLimitStore({ NODE_ENV: "production" }, factories).ok, false);
    assert.equal(selectRateLimitStore({ NODE_ENV: "production", RATE_LIMIT_STORE: "  " }, factories).ok, false);
  });

  it("uses memory in development, with a not-production-safe warning", () => {
    const selection = selectRateLimitStore({ NODE_ENV: "development" }, factories);
    assert.ok(selection.ok);
    assert.match(selection.warning!, /Not production-safe/);
  });

  it("allows memory in production only when explicitly chosen, still with the warning", () => {
    const selection = selectRateLimitStore({ NODE_ENV: "production", RATE_LIMIT_STORE: "memory" }, factories);
    assert.ok(selection.ok && selection.warning);
  });

  it("uses DynamoDB with the configured table and optional region, without a warning", () => {
    const selection = selectRateLimitStore({ NODE_ENV: "production", RATE_LIMIT_STORE: "DynamoDB", RATE_LIMIT_TABLE: " limits ", RATE_LIMIT_REGION: "us-east-2" }, factories);
    assert.ok(selection.ok && selection.store.sharedAcrossInstances && !selection.warning);
    assert.deepEqual(dynamoCalls.at(-1), ["limits", "us-east-2"]);
    selectRateLimitStore({ RATE_LIMIT_STORE: "dynamodb", RATE_LIMIT_TABLE: "limits" }, factories);
    assert.deepEqual(dynamoCalls.at(-1), ["limits", undefined]);
  });

  it("refuses DynamoDB without a table name or when the store can't be created", () => {
    assert.match((selectRateLimitStore({ RATE_LIMIT_STORE: "dynamodb" }, factories) as { reason: string }).reason, /RATE_LIMIT_TABLE/);
    const throwing = { ...factories, dynamodb: () => { throw new Error("bad table"); } };
    assert.equal(selectRateLimitStore({ RATE_LIMIT_STORE: "dynamodb", RATE_LIMIT_TABLE: "x y" }, throwing).ok, false);
  });

  it("rejects unknown store names", () => {
    assert.equal(selectRateLimitStore({ RATE_LIMIT_STORE: "redis" }, factories).ok, false);
  });
});

describe("checkAiRateLimits", () => {
  it("limits each trusted visitor separately", async () => {
    const store = createMemoryRateLimitStore();
    for (let i = 0; i < AI_RATE_LIMITS.perClient.limit; i++) assert.equal((await checkAiRateLimits(store, ip("203.0.113.1"), i)).allowed, true);
    const blocked = await checkAiRateLimits(store, ip("203.0.113.1"), 10);
    assert.deepEqual(blocked.allowed ? null : blocked.scope, "client");
    assert.equal((await checkAiRateLimits(store, ip("203.0.113.2"), 10)).allowed, true);
  });

  it("puts every unverified visitor in one shared bucket", async () => {
    const store = createMemoryRateLimitStore();
    for (let i = 0; i < AI_RATE_LIMITS.unverified.limit; i++) await checkAiRateLimits(store, unverified, i);
    const blocked = await checkAiRateLimits(store, { kind: "unverified", reason: "different reason" }, 20);
    assert.equal(blocked.allowed ? null : blocked.scope, "unverified");
  });

  it("can't be bypassed by rotating forged X-Forwarded-For values when no hop count is trusted", async () => {
    const store = createMemoryRateLimitStore();
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      const identity = resolveClientIdentity(new Headers({ "x-forwarded-for": `198.51.100.${i}` }), null);
      if ((await checkAiRateLimits(store, identity, i)).allowed) allowed++;
    }
    assert.equal(allowed, AI_RATE_LIMITS.unverified.limit);
  });

  it("can't be bypassed by rotating forged leading entries when one hop is trusted", async () => {
    const store = createMemoryRateLimitStore();
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      const identity = resolveClientIdentity(new Headers({ "x-forwarded-for": `198.51.100.${i}, 203.0.113.9` }), 1);
      if ((await checkAiRateLimits(store, identity, i)).allowed) allowed++;
    }
    assert.equal(allowed, AI_RATE_LIMITS.perClient.limit);
  });

  it("enforces the global daily cap across all visitors", async () => {
    const store = createMemoryRateLimitStore({ maxKeys: 10_000 });
    let allowed = 0;
    for (let i = 0; i < AI_RATE_LIMITS.daily.limit + 20; i++) {
      if ((await checkAiRateLimits(store, ip(`10.0.${Math.floor(i / 250)}.${i % 250}`), i)).allowed) allowed++;
    }
    assert.equal(allowed, AI_RATE_LIMITS.daily.limit);
    const blocked = await checkAiRateLimits(store, ip("192.0.2.200"), 1_000);
    assert.equal(blocked.allowed ? null : blocked.scope, "daily");
  });

  it("never stores the raw IP address", async () => {
    const keys: string[] = [];
    const recording: RateLimitStore = { name: "spy", sharedAcrossInstances: true, hit: async (key) => (keys.push(key), { allowed: true }) };
    await checkAiRateLimits(recording, ip("203.0.113.77"), 0);
    assert.ok(keys.every((key) => !key.includes("203.0.113.77")));
    assert.match(keys[0], /^client:[0-9a-f]{32}$/);
  });
});
