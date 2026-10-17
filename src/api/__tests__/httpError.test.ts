import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { AddressInfo } from "net";
import errorHandler from "../middlewares/errorHandler.middleware";
import { asyncHandler } from "../middlewares/express-ts-helper";
import { badRequest, conflict } from "../errors/httpError";

test("HttpError thrown from an async handler yields the standard body", async () => {
  const app = express();
  app.get("/conflict", asyncHandler(async () => {
    throw conflict("Reward already claimed", "ALREADY_CLAIMED", { rewardId: "r1" });
  }));
  app.get("/legacy", asyncHandler(async () => {
    throw badRequest("Character ID is required").withLegacy({ success: false });
  }));
  app.get("/boom", asyncHandler(async () => {
    throw new Error("db exploded");
  }));
  app.use(errorHandler);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const origError = console.error;
  console.error = () => {};
  try {
    const r1 = await fetch(`${base}/conflict`);
    assert.equal(r1.status, 409);
    assert.deepEqual(await r1.json(), {
      error: "Reward already claimed",
      message: "Reward already claimed",
      code: "ALREADY_CLAIMED",
      details: { rewardId: "r1" },
    });
    const r3 = await fetch(`${base}/legacy`);
    assert.equal(r3.status, 400);
    assert.deepEqual(await r3.json(), {
      success: false,
      error: "Character ID is required",
      message: "Character ID is required",
      code: "BAD_REQUEST",
    });
    // Unexpected errors still become a 500 instead of hanging the request.
    const r2 = await fetch(`${base}/boom`);
    assert.equal(r2.status, 500);
  } finally {
    console.error = origError;
    server.close();
  }
});
