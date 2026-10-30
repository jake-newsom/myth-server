import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../validateConfig";

const valid = {
  DATABASE_URL: "postgres://user:hunter2@localhost/db",
  JWT_SECRET: "s".repeat(32),
};

test("accepts the minimum valid config", () => {
  assert.doesNotThrow(() => validateConfig(valid));
});

test("lists every problem at once", () => {
  assert.throws(
    () => validateConfig({ BCRYPT_SALT_ROUNDS: "ten", PORT: "abc", REDIS_PORT: "0" }),
    (err: Error) =>
      ["DATABASE_URL", "JWT_SECRET", "BCRYPT_SALT_ROUNDS", "PORT", "REDIS_PORT"].every((name) =>
        err.message.includes(name)
      )
  );
});

test("rejects a short JWT_SECRET without printing values", () => {
  assert.throws(
    () => validateConfig({ ...valid, JWT_SECRET: "tooshort-secret" }),
    (err: Error) => err.message.includes("JWT_SECRET") && !err.message.includes("tooshort-secret")
  );
});

test("missing Redis does not stop boot", (t) => {
  t.mock.method(console, "warn", () => {});
  assert.doesNotThrow(() => validateConfig({ ...valid, NODE_ENV: "production" }));
});
