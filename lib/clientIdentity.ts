import { isIP } from "node:net";

export type ClientIdentity = { kind: "ip"; ip: string } | { kind: "unverified"; reason: string };

/** Highest number of trusted proxy hops accepted from configuration. */
export const MAX_TRUSTED_PROXY_HOPS = 5;

/**
 * Reads TRUSTED_PROXY_HOPS: how many proxies in front of this app append to X-Forwarded-For.
 * Returns null (meaning "don't trust X-Forwarded-For at all") unless it's a whole number from 1 to 5.
 */
export function parseTrustedProxyHops(value: string | undefined): number | null {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) return null;
  const hops = Number(value);
  return hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS ? hops : null;
}

/**
 * Works out the visitor's IP address, but only when it can be trusted.
 *
 * Each proxy appends the address it received the request from to the END of X-Forwarded-For, and anything
 * already in the header came from the visitor and can be forged. With `trustedHops` proxies in front of the app,
 * the entry added by the outermost trusted proxy is `trustedHops` from the right, and that one is the real
 * client. Everything to its left is ignored. Without a verified hop count, no entry is trusted.
 * X-Real-IP and similar headers are never used because a visitor can set them directly.
 */
export function resolveClientIdentity(headers: Headers, trustedHops: number | null): ClientIdentity {
  if (trustedHops === null) return { kind: "unverified", reason: "TRUSTED_PROXY_HOPS is not configured" };

  const header = headers.get("x-forwarded-for");
  if (!header) return { kind: "unverified", reason: "no X-Forwarded-For header" };

  const entries = header.split(",").map((entry) => entry.trim());
  if (entries.length < trustedHops) return { kind: "unverified", reason: "fewer X-Forwarded-For entries than trusted proxies" };

  const candidate = entries[entries.length - trustedHops];
  if (isIP(candidate) === 0) return { kind: "unverified", reason: "trusted X-Forwarded-For entry is not a valid IP address" };

  return { kind: "ip", ip: candidate.toLowerCase() };
}
