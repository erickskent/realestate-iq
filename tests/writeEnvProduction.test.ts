import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildEnvProduction, encodeEnvValue, RUNTIME_ENV_VARS, writeEnvProduction } from "../scripts/write-env-production.mjs";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

/** Made-up values only. Several contain characters Next.js would otherwise alter. */
const FAKE = {
  ANTHROPIC_API_KEY: "fake-key-not-real_AbC123-$HOME-#x",
  RATE_LIMIT_STORE: "dynamodb",
  RATE_LIMIT_TABLE: "realestate-iq-rate-limits",
  RATE_LIMIT_REGION: "us-east-2",
};

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "riq-env-"));
}

describe("write-env-production", () => {
  it("covers exactly the four approved variables", () => {
    assert.deepEqual(RUNTIME_ENV_VARS, ["ANTHROPIC_API_KEY", "RATE_LIMIT_STORE", "RATE_LIMIT_TABLE", "RATE_LIMIT_REGION"]);
  });

  it("writes values Next.js reads back unchanged, including $, #, spaces, and other quotes", () => {
    const dir = tempDir();
    const tricky = { ...FAKE, RATE_LIMIT_TABLE: ' a$$b ${X} "c" `d` \\n e=f ' };
    try {
      assert.ok(writeEnvProduction(tricky, dir).ok);
      const before = { ...process.env };
      for (const name of RUNTIME_ENV_VARS) delete process.env[name];
      try {
        const { combinedEnv } = loadEnvConfig(dir, false, { info() {}, error() {} }, true);
        for (const name of RUNTIME_ENV_VARS) assert.equal(combinedEnv[name], tricky[name as keyof typeof tricky], name);
      } finally {
        for (const name of RUNTIME_ENV_VARS) delete process.env[name];
        Object.assign(process.env, before);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores every other variable, including TRUSTED_PROXY_HOPS and unrelated secrets", () => {
    const { content } = buildEnvProduction({ ...FAKE, TRUSTED_PROXY_HOPS: "1", AWS_SECRET_ACCESS_KEY: "nope", NEXT_PUBLIC_X: "nope" });
    assert.deepEqual(content.trim().split("\n").map((line) => line.split("=")[0]), RUNTIME_ENV_VARS);
    assert.doesNotMatch(content, /TRUSTED_PROXY_HOPS|AWS_SECRET|NEXT_PUBLIC|nope/);
  });

  it("skips unset or empty variables instead of writing blanks", () => {
    const result = buildEnvProduction({ RATE_LIMIT_STORE: "dynamodb", RATE_LIMIT_TABLE: "" });
    assert.deepEqual(result.written, ["RATE_LIMIT_STORE"]);
    assert.deepEqual(result.skipped, ["ANTHROPIC_API_KEY", "RATE_LIMIT_TABLE", "RATE_LIMIT_REGION"]);
    assert.equal(result.content, "RATE_LIMIT_STORE='dynamodb'\n");
  });

  it("refuses values with quotes or line breaks, writes nothing, and never echoes the value", () => {
    for (const bad of ["it's", "line1\nline2", "a\rb", "a\0b"]) {
      const dir = tempDir();
      try {
        const result = writeEnvProduction({ ...FAKE, ANTHROPIC_API_KEY: bad }, dir);
        assert.equal(result.ok, false);
        assert.match(result.message, /ANTHROPIC_API_KEY/);
        assert.ok(!result.message.includes(bad));
        assert.throws(() => statSync(path.join(dir, ".env.production")), "no file written");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("lists variable names, never values, in its summary", () => {
    const dir = tempDir();
    try {
      const { ok, message } = writeEnvProduction(FAKE, dir);
      assert.ok(ok);
      for (const value of Object.values(FAKE)) assert.ok(!message.includes(value), "value leaked into summary");
      assert.match(message, /ANTHROPIC_API_KEY, RATE_LIMIT_STORE, RATE_LIMIT_TABLE, RATE_LIMIT_REGION/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces any existing file and makes it readable only by its owner", () => {
    const dir = tempDir();
    try {
      writeEnvProduction({ ...FAKE, RATE_LIMIT_REGION: "us-west-1" }, dir);
      writeEnvProduction(FAKE, dir);
      const file = path.join(dir, ".env.production");
      assert.equal(readFileSync(file, "utf8").match(/RATE_LIMIT_REGION/g)!.length, 1, "no duplicate lines");
      assert.equal(statSync(file).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("escapes $ so Next.js doesn't expand it", () => {
    assert.equal(encodeEnvValue("a$b"), "'a\\$b'");
  });
});
