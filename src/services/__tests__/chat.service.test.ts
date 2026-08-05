import { test, describe } from "node:test";
import assert from "node:assert";
import {
  resolveChannelForUser,
  isBannerWorthyRarity,
} from "../chat.service";
import { ChatError } from "../../types/chat.types";
import { Rarity } from "../../types/card.types";
import chatRateLimit from "../chatRateLimit.service";
import { CHAT_CONFIG } from "../../config/constants";

const USER_A = "11111111-1111-1111-1111-111111111111";

describe("resolveChannelForUser", () => {
  test("global resolves to the shared global room", async () => {
    const resolved = await resolveChannelForUser(USER_A, { type: "global" });
    assert.equal(resolved.type, "global");
    assert.equal(resolved.key, null);
    assert.equal(resolved.room, "chat:global");
  });

  test("a non-member requesting guild is rejected", async () => {
    // getGuildIdForUser is the pre-guilds stub and returns null, so every
    // user is currently a non-member.
    await assert.rejects(
      () => resolveChannelForUser(USER_A, { type: "guild" }),
      (error: unknown) => {
        assert.ok(error instanceof ChatError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.code, "forbidden");
        return true;
      }
    );
  });

  test("an unknown channel is rejected", async () => {
    await assert.rejects(
      () =>
        resolveChannelForUser(USER_A, {
          type: "system" as unknown as "global",
        }),
      (error: unknown) => error instanceof ChatError
    );
  });

  test("a client-supplied key cannot influence the resolved channel", async () => {
    // The resolver's signature accepts no key at all -- entitlement is derived
    // purely from the user id. This test pins that contract: passing extra
    // fields must not change the result.
    const forged = { type: "global", key: "someone-elses-guild" } as {
      type: "global";
    };
    const resolved = await resolveChannelForUser(USER_A, forged);
    assert.equal(resolved.key, null);
    assert.equal(resolved.room, "chat:global");
  });
});

describe("isBannerWorthyRarity (pack pull predicate)", () => {
  const qualifies: Rarity[] = ["legendary+", "legendary++", "legendary+++"];
  const doesNot: Rarity[] = [
    "legendary",
    "epic",
    "epic+++",
    "rare+",
    "common",
    "uncommon++",
  ];

  for (const rarity of qualifies) {
    test(`"${rarity}" qualifies`, () => {
      assert.equal(isBannerWorthyRarity(rarity), true);
    });
  }

  for (const rarity of doesNot) {
    test(`"${rarity}" does not qualify`, () => {
      assert.equal(isBannerWorthyRarity(rarity), false);
    });
  }
});

describe("chatRateLimit", () => {
  const { BURST, MIN_INTERVAL_MS, SHARE_INTERVAL_MS } = CHAT_CONFIG.RATE_LIMIT;

  test("allows a burst then blocks", () => {
    chatRateLimit.resetAll();
    const user = "burst-user";
    let now = 1_000_000;

    // Send at exactly the 1/sec floor. Each 1s gap also refills half a token
    // (BURST tokens per 10s window), so the bucket drains over more than
    // BURST sends -- keep going until the bucket, not the floor, rejects us.
    let allowedCount = 0;
    let blocked: { allowed: boolean; retryAfterMs: number } | null = null;

    for (let i = 0; i < 50; i++) {
      const result = chatRateLimit.consumeMessage(user, now);
      if (result.allowed) {
        allowedCount++;
        now += MIN_INTERVAL_MS;
        continue;
      }
      blocked = result;
      break;
    }

    assert.ok(
      allowedCount >= BURST,
      `expected at least the burst (${BURST}) to be allowed, got ${allowedCount}`
    );
    assert.ok(blocked, "expected the bucket to eventually reject a send");
    assert.equal(blocked?.allowed, false);
    assert.ok((blocked?.retryAfterMs ?? 0) > 0);
  });

  test("a rapid burst with no delay is capped at BURST", () => {
    chatRateLimit.resetAll();
    const user = "instant-burst-user";
    const now = 1_500_000;

    // All at the same instant: no refill, and the 1/sec floor rejects
    // everything after the first send.
    assert.equal(chatRateLimit.consumeMessage(user, now).allowed, true);
    for (let i = 0; i < BURST + 3; i++) {
      assert.equal(chatRateLimit.consumeMessage(user, now).allowed, false);
    }
  });

  test("enforces the 1/sec hard floor", () => {
    chatRateLimit.resetAll();
    const user = "fast-user";
    const now = 2_000_000;

    assert.equal(chatRateLimit.consumeMessage(user, now).allowed, true);
    const tooSoon = chatRateLimit.consumeMessage(user, now + 100);
    assert.equal(tooSoon.allowed, false);
    assert.equal(tooSoon.retryAfterMs, MIN_INTERVAL_MS - 100);
  });

  test("refills over time", () => {
    chatRateLimit.resetAll();
    const user = "refill-user";
    let now = 3_000_000;

    // Drain the bucket, stepping by the 1/sec floor until it rejects.
    for (let i = 0; i < 50; i++) {
      if (!chatRateLimit.consumeMessage(user, now).allowed) break;
      now += MIN_INTERVAL_MS;
    }
    assert.equal(chatRateLimit.consumeMessage(user, now).allowed, false);

    // Wait out a full refill window; the bucket is full again.
    now += CHAT_CONFIG.RATE_LIMIT.REFILL_WINDOW_MS;
    assert.equal(chatRateLimit.consumeMessage(user, now).allowed, true);
  });

  test("shares are limited more tightly than text", () => {
    chatRateLimit.resetAll();
    const user = "share-user";
    const now = 4_000_000;

    assert.equal(chatRateLimit.consumeShare(user, now).allowed, true);

    // A second share well past the text floor is still blocked by the
    // dedicated share interval.
    const second = chatRateLimit.consumeShare(user, now + MIN_INTERVAL_MS * 2);
    assert.equal(second.allowed, false);

    const later = chatRateLimit.consumeShare(user, now + SHARE_INTERVAL_MS);
    assert.equal(later.allowed, true);
  });

  test("a blocked share does not burn a bucket token", () => {
    chatRateLimit.resetAll();
    const user = "share-token-user";
    const now = 5_000_000;

    chatRateLimit.consumeShare(user, now);
    // Rejected by the share interval...
    chatRateLimit.consumeShare(user, now + MIN_INTERVAL_MS);
    // ...so a normal text message is still allowed from the remaining tokens.
    assert.equal(
      chatRateLimit.consumeMessage(user, now + MIN_INTERVAL_MS * 2).allowed,
      true
    );
  });

  test("buckets are independent per user", () => {
    chatRateLimit.resetAll();
    const now = 6_000_000;
    assert.equal(chatRateLimit.consumeMessage("user-1", now).allowed, true);
    assert.equal(chatRateLimit.consumeMessage("user-2", now).allowed, true);
  });
});
