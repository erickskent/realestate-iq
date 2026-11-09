import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrustedProxyHops, resolveClientIdentity } from "../lib/clientIdentity.ts";

const headers = (values: Record<string, string>) => new Headers(values);

describe("parseTrustedProxyHops", () => {
  it("accepts whole numbers from 1 to 5", () => {
    assert.equal(parseTrustedProxyHops("1"), 1);
    assert.equal(parseTrustedProxyHops(" 2 "), 2);
    assert.equal(parseTrustedProxyHops("5"), 5);
  });

  it("treats missing or invalid values as 'do not trust X-Forwarded-For'", () => {
    for (const value of [undefined, "", "0", "6", "-1", "1.5", "two", "1,2", "true"]) {
      assert.equal(parseTrustedProxyHops(value), null, String(value));
    }
  });
});

describe("resolveClientIdentity", () => {
  it("trusts no header at all until the proxy hop count is configured", () => {
    const identity = resolveClientIdentity(headers({ "x-forwarded-for": "198.51.100.7" }), null);
    assert.equal(identity.kind, "unverified");
  });

  it("uses the entry appended by the outermost trusted proxy, counting from the right", () => {
    const h = headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    assert.deepEqual(resolveClientIdentity(h, 1), { kind: "ip", ip: "10.0.0.1" });
    assert.deepEqual(resolveClientIdentity(h, 2), { kind: "ip", ip: "198.51.100.7" });
  });

  it("ignores forged entries a visitor prepends", () => {
    // The visitor sent "X-Forwarded-For: 1.2.3.4, 5.6.7.8"; the one trusted proxy appended the real address.
    const spoofed = headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.9" });
    assert.deepEqual(resolveClientIdentity(spoofed, 1), { kind: "ip", ip: "203.0.113.9" });
  });

  it("gives a visitor the same identity however they rotate forged entries", () => {
    const identities = ["1.1.1.1", "2.2.2.2, 3.3.3.3", "not-an-ip", ""].map((forged) =>
      resolveClientIdentity(headers({ "x-forwarded-for": forged ? `${forged}, 203.0.113.9` : "203.0.113.9" }), 1),
    );
    for (const identity of identities) assert.deepEqual(identity, { kind: "ip", ip: "203.0.113.9" });
  });

  it("never uses X-Real-IP or similar headers a visitor can set directly", () => {
    const h = headers({ "x-real-ip": "198.51.100.7", "cf-connecting-ip": "198.51.100.8", "true-client-ip": "198.51.100.9" });
    assert.equal(resolveClientIdentity(h, 1).kind, "unverified");
  });

  it("is unverified when there are fewer entries than trusted proxies", () => {
    assert.equal(resolveClientIdentity(headers({ "x-forwarded-for": "203.0.113.9" }), 2).kind, "unverified");
  });

  it("is unverified when the trusted entry isn't a valid IP address", () => {
    for (const value of ["1.2.3.4, garbage", "1.2.3.4, ", "1.2.3.4, 999.1.1.1", "1.2.3.4, 203.0.113.9:443"]) {
      assert.equal(resolveClientIdentity(headers({ "x-forwarded-for": value }), 1).kind, "unverified", value);
    }
  });

  it("accepts IPv6 addresses and normalizes their case", () => {
    assert.deepEqual(resolveClientIdentity(headers({ "x-forwarded-for": "2001:DB8::1" }), 1), { kind: "ip", ip: "2001:db8::1" });
  });

  it("handles a request with several X-Forwarded-For headers as one combined list", () => {
    const h = new Headers();
    h.append("x-forwarded-for", "1.2.3.4");
    h.append("x-forwarded-for", "203.0.113.9");
    assert.deepEqual(resolveClientIdentity(h, 1), { kind: "ip", ip: "203.0.113.9" });
  });
});
