import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import ChatModel from "../../models/chat.model";
import chatRateLimit from "../chatRateLimit.service";
import * as chat from "../chat.service";
import { ChatSocketEvent } from "../../types/chat.types";

/**
 * End-to-end check of the send pipeline's emit behaviour against a fake
 * Socket.IO namespace.
 *
 * The pure profanity unit tests prove masking works; these prove the masked
 * text actually REACHES a filter-on viewer, which is where a delivery bug
 * would hide.
 */

type Frame = { event: string; payload: any };

class FakeSocket {
  public data: { userId?: string } = {};
  public received: Frame[] = [];
  public rooms = new Set<string>();
  constructor(public id: string, userId?: string) {
    if (userId) this.data.userId = userId;
  }
  join(room: string) { this.rooms.add(room); }
  emit(event: string, payload: any) { this.received.push({ event, payload }); }
  bodies() {
    return this.received
      .filter((f) => f.event === ChatSocketEvent.SERVER_MESSAGE)
      .map((f) => f.payload.body);
  }
}

class FakeNamespace {
  public sockets: FakeSocket[] = [];
  to() {
    return { emit: (event: string, payload: any) => {
      for (const s of this.sockets) s.emit(event, payload);
    }};
  }
  in() { return { fetchSockets: async () => this.sockets }; }
}

// Stub persistence so these tests need no database.
let inserted: any = null;
const originalInsert = ChatModel.insertMessage;
const originalGetState = ChatModel.getUserState;
const originalSetFilter = ChatModel.setProfanityFilter;

function stubModel() {
  (ChatModel as any).insertMessage = async (input: any) => {
    inserted = {
      message_id: "msg-1",
      channel_type: input.channelType,
      channel_key: input.channelKey,
      sender_id: input.senderId,
      sender_username: input.senderUsername,
      kind: input.kind,
      body: input.body,
      payload: input.payload,
      is_deleted: false,
      deleted_by: null,
      deleted_at: null,
      created_at: new Date(),
    };
    return inserted;
  };
  (ChatModel as any).getUserState = async () => null;
  (ChatModel as any).setProfanityFilter = async (userId: string, enabled: boolean) => ({
    user_id: userId,
    profanity_filter_enabled: enabled,
    muted_until: null,
    muted_reason: null,
    updated_at: new Date(),
  });
}

function restoreModel() {
  (ChatModel as any).insertMessage = originalInsert;
  (ChatModel as any).getUserState = originalGetState;
  (ChatModel as any).setProfanityFilter = originalSetFilter;
}

const sender = { user_id: "sender-1", username: "Sender" };

describe("chat pipeline - profanity reaches viewers correctly", () => {
  beforeEach(() => {
    stubModel();
    inserted = null;
    // Each test sends as the same user; without this the shared token bucket
    // rejects everything after the first test.
    chatRateLimit.resetAll();
  });

  test("filter-on viewer gets masked, filter-off gets raw", async () => {
    const ns = new FakeNamespace();
    chat.setPresenceNamespace(ns as any);

    const onSock = new FakeSocket("s1", "user-on");
    const offSock = new FakeSocket("s2", "user-off");
    ns.sockets = [onSock, offSock];

    // Set real preferences through the public API (writes cache + "DB").
    await chat.setProfanityFilterEnabled("user-on", true);
    await chat.setProfanityFilterEnabled("user-off", false);

    const socket: any = { user: sender, data: {} };
    await chat.sendTextMessage(socket, "global", "what the fuck");


    assert.deepEqual(onSock.bodies(), ["what the f***"]);
    assert.deepEqual(offSock.bodies(), ["what the fuck"]);
    restoreModel();
  });

  test("persisted body stays raw for moderation", async () => {
    const ns = new FakeNamespace();
    chat.setPresenceNamespace(ns as any);
    ns.sockets = [new FakeSocket("s1", "user-on")];
    await chat.setProfanityFilterEnabled("user-on", true);

    const socket: any = { user: sender, data: {} };
    await chat.sendTextMessage(socket, "global", "fuck");
    assert.equal(inserted.body, "fuck");
    restoreModel();
  });

  test("a viewer with no cached state defaults to filtered", async () => {
    const ns = new FakeNamespace();
    chat.setPresenceNamespace(ns as any);
    const unknown = new FakeSocket("s3", "never-seen-user");
    ns.sockets = [unknown];

    const socket: any = { user: sender, data: {} };
    await chat.sendTextMessage(socket, "global", "fuck");
    assert.deepEqual(unknown.bodies(), ["f***"]);
    restoreModel();
  });

  test("clean message takes the single-frame fast path", async () => {
    const ns = new FakeNamespace();
    chat.setPresenceNamespace(ns as any);
    const a = new FakeSocket("s1", "user-on");
    ns.sockets = [a];
    await chat.setProfanityFilterEnabled("user-on", true);

    const socket: any = { user: sender, data: {} };
    await chat.sendTextMessage(socket, "global", "good game");
    assert.deepEqual(a.bodies(), ["good game"]);
    restoreModel();
  });
});

describe("chat pipeline - cache warm race", () => {
  test("an unwarmed viewer's REAL preference is loaded, not the default", async () => {
    chatRateLimit.resetAll();
    inserted = null;

    // Model reports this user has the filter OFF, but nothing has warmed the
    // cache yet -- the broadcast must go and fetch it rather than assuming.
    (ChatModel as any).insertMessage = async (input: any) => ({
      message_id: "msg-x", channel_type: input.channelType,
      channel_key: input.channelKey, sender_id: input.senderId,
      sender_username: input.senderUsername, kind: input.kind,
      body: input.body, payload: input.payload, is_deleted: false,
      deleted_by: null, deleted_at: null, created_at: new Date(),
    });
    (ChatModel as any).getUserState = async (userId: string) =>
      userId === "cold-off-user"
        ? { user_id: userId, profanity_filter_enabled: false,
            muted_until: null, muted_reason: null, updated_at: new Date() }
        : null;

    const ns = new FakeNamespace();
    chat.setPresenceNamespace(ns as any);

    chat.releaseUserState("cold-off-user");
    const cold = new FakeSocket("s10", "cold-off-user");
    ns.sockets = [cold];

    const socket: any = { user: sender, data: {} };
    await chat.sendTextMessage(socket, "global", "fuck");

    // Their stored preference is OFF, so they must get the raw text even
    // though their state was not cached when the message was sent.
    assert.deepEqual(cold.bodies(), ["fuck"]);
    restoreModel();
  });

  test("a viewer whose state is still loading defaults to filtered", async () => {
    stubModel();
    chatRateLimit.resetAll();

    const ns = new FakeNamespace();
    chat.setPresenceNamespace(ns as any);

    // Socket is in the room but loadUserState has NOT completed, so the
    // cache has no entry for this viewer.
    chat.releaseUserState("racing-user");
    const racing = new FakeSocket("s9", "racing-user");
    ns.sockets = [racing];

    const socket: any = { user: sender, data: {} };
    await chat.sendTextMessage(socket, "global", "fuck");

    // Safe direction: unknown preference must mask, not leak.
    assert.deepEqual(racing.bodies(), ["f***"]);
    restoreModel();
  });
});
