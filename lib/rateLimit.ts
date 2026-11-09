import { createHash } from "node:crypto";
import type { ClientIdentity } from "./clientIdentity.ts";

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Where request counts are kept. A production store must be shared by every server instance. */
export interface RateLimitStore {
  readonly name: string;
  /** True only when every server instance sees the same counts. */
  readonly sharedAcrossInstances: boolean;
  /** Records one request for `key` and reports whether it is within `limit` per `windowMs`. */
  hit(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitResult>;
}

/**
 * Sliding-window counts held in this process's memory. NOT production-safe on hosting that runs several
 * instances (such as AWS Amplify): each instance keeps its own counts, and counts reset when an instance restarts.
 * Suitable for local development and single-instance testing only.
 */
export function createMemoryRateLimitStore({ maxKeys = 5_000 }: { maxKeys?: number } = {}): RateLimitStore {
  const hits = new Map<string, number[]>();

  return {
    name: "memory",
    sharedAcrossInstances: false,
    async hit(key, limit, windowMs, now) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }

      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);

      // Forget the least recently used keys so memory stays bounded.
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
      return { allowed: true };
    },
  };
}

export type StoreSelection = { ok: true; store: RateLimitStore; warning?: string } | { ok: false; reason: string };

export type StoreFactories = {
  memory: () => RateLimitStore;
  /** Builds the shared DynamoDB store. Kept out of this file so it has no AWS dependency. */
  dynamodb: (tableName: string, region: string | undefined) => RateLimitStore;
};

/**
 * Chooses the rate-limit store from configuration. In production it refuses to run without an explicit choice,
 * so in-memory limits are never used there by accident.
 */
export function selectRateLimitStore(
  env: { NODE_ENV?: string; RATE_LIMIT_STORE?: string; RATE_LIMIT_TABLE?: string; RATE_LIMIT_REGION?: string },
  factories: StoreFactories,
): StoreSelection {
  const choice = env.RATE_LIMIT_STORE?.trim().toLowerCase() || undefined;
  const memoryWarning = "In-memory rate limiting: counts are per server instance and reset on restart. Not production-safe.";

  if (choice === "memory") return { ok: true, store: factories.memory(), warning: memoryWarning };
  if (choice === undefined) {
    return env.NODE_ENV === "production"
      ? { ok: false, reason: "No shared rate-limit store is configured (RATE_LIMIT_STORE is not set)." }
      : { ok: true, store: factories.memory(), warning: memoryWarning };
  }
  if (choice === "dynamodb") {
    const tableName = env.RATE_LIMIT_TABLE?.trim();
    if (!tableName) return { ok: false, reason: "RATE_LIMIT_STORE is dynamodb but RATE_LIMIT_TABLE is not set." };
    try {
      return { ok: true, store: factories.dynamodb(tableName, env.RATE_LIMIT_REGION?.trim() || undefined) };
    } catch {
      return { ok: false, reason: "The DynamoDB rate-limit store could not be created (check RATE_LIMIT_TABLE)." };
    }
  }
  return { ok: false, reason: "RATE_LIMIT_STORE has an unrecognized value." };
}

/** Request limits for AI analyses. Ratios of requests to time windows. */
export const AI_RATE_LIMITS = {
  /** Per visitor, when the visitor's IP address can be trusted. */
  perClient: { limit: 5, windowMs: 10 * 60 * 1000 },
  /** Shared by ALL visitors whose IP can't be trusted, so forged headers can't create fresh allowances. */
  unverified: { limit: 10, windowMs: 10 * 60 * 1000 },
  /** Across everyone, per rolling 24 hours. */
  daily: { limit: 100, windowMs: 24 * 60 * 60 * 1000 },
} as const;

export type LimitDecision = { allowed: true } | { allowed: false; scope: "client" | "unverified" | "daily"; retryAfterSeconds: number };

/** Stores a one-way hash of the IP rather than the address itself. */
function clientKey(ip: string): string {
  return `client:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

/** Applies the per-visitor (or shared unverified) limit, then the global daily cap. */
export async function checkAiRateLimits(store: RateLimitStore, identity: ClientIdentity, now: number): Promise<LimitDecision> {
  const visitor =
    identity.kind === "ip"
      ? { scope: "client" as const, key: clientKey(identity.ip), ...AI_RATE_LIMITS.perClient }
      : { scope: "unverified" as const, key: "unverified", ...AI_RATE_LIMITS.unverified };

  const visitorResult = await store.hit(visitor.key, visitor.limit, visitor.windowMs, now);
  if (!visitorResult.allowed) return { allowed: false, scope: visitor.scope, retryAfterSeconds: visitorResult.retryAfterSeconds };

  const dailyResult = await store.hit("daily", AI_RATE_LIMITS.daily.limit, AI_RATE_LIMITS.daily.windowMs, now);
  if (!dailyResult.allowed) return { allowed: false, scope: "daily", retryAfterSeconds: dailyResult.retryAfterSeconds };

  return { allowed: true };
}
