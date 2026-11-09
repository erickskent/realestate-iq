import { ConditionalCheckFailedException, DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { RateLimitStore } from "./rateLimit.ts";

/** The one DynamoDB call this store makes. Lets tests substitute a fake table without network access. */
export type UpdateItemSender = { send(command: UpdateItemCommand): Promise<unknown> };

/** Extra time counters stay in the table after their window ends, before DynamoDB's TTL removes them. */
const EXPIRY_GRACE_SECONDS = 60 * 60;

/** DynamoDB table names: 3–255 characters, letters, digits, underscore, hyphen, and period. */
export function isValidTableName(name: string): boolean {
  return /^[A-Za-z0-9_.-]{3,255}$/.test(name);
}

/** Start of the fixed window that `now` falls in. Windows are aligned to the Unix epoch, so daily windows start at 00:00 UTC. */
export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Rate-limit counts kept in a DynamoDB table, shared by every server instance.
 *
 * Each key gets one item per fixed time window (partition key `pk` = "<key>#<window start>"). A request adds 1 to
 * the item's `count` in a single atomic UpdateItem, conditioned on the count still being below the limit, so two
 * instances can never both take the last slot and rejected requests don't use up allowance. `expiresAt` (Unix
 * seconds) lets DynamoDB's Time to Live delete finished windows automatically.
 *
 * Table requirements: partition key `pk` (String), no sort key, TTL enabled on `expiresAt`.
 * Permission required: dynamodb:UpdateItem on this table only.
 */
export function createDynamoRateLimitStore({ tableName, client }: { tableName: string; client: UpdateItemSender }): RateLimitStore {
  if (!isValidTableName(tableName)) throw new Error("Invalid DynamoDB table name for the rate-limit store.");

  return {
    name: "dynamodb",
    sharedAcrossInstances: true,
    async hit(key, limit, windowMs, now) {
      const start = windowStart(now, windowMs);
      const end = start + windowMs;

      try {
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { pk: { S: `${key}#${start}` } },
            UpdateExpression: "ADD #count :one SET #expiresAt = if_not_exists(#expiresAt, :expiresAt)",
            ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
            ExpressionAttributeNames: { "#count": "count", "#expiresAt": "expiresAt" },
            ExpressionAttributeValues: {
              ":one": { N: "1" },
              ":limit": { N: String(limit) },
              ":expiresAt": { N: String(Math.ceil(end / 1000) + EXPIRY_GRACE_SECONDS) },
            },
          }),
        );
        return { allowed: true };
      } catch (error) {
        // The condition failing means the window is already full. Any other error is re-thrown so the caller fails closed.
        if (error instanceof ConditionalCheckFailedException) {
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((end - now) / 1000)) };
        }
        throw error;
      }
    },
  };
}

/**
 * Real DynamoDB client with short timeouts, so a slow or unreachable table fails fast instead of holding the request.
 * Credentials come from the default AWS provider chain (on Amplify, the app's compute role). No keys are passed in code.
 */
export function createDynamoClient(region?: string): DynamoDBClient {
  return new DynamoDBClient({
    ...(region ? { region } : {}),
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 2_000, throwOnRequestTimeout: true },
  });
}
