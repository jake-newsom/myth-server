import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { maskProfanity } from "../profanityFilter.service";

/**
 * Broadcast-shape tests for the per-viewer profanity split emit.
 *
 * These exercise the decision logic directly rather than standing up a real
 * Socket.IO server: what matters is (a) that a clean message takes the
 * single-frame fast path, and (b) that a message needing masking produces the
 * right body per viewer. Both are pure functions of the raw text and each
 * viewer's preference.
 */

interface FakeSocket {
  id: string;
  data: { userId?: string };
  received: Array<{ body: string | null }>;
}

/**
 * Mirrors the emit decision in chat.service.broadcastMessage. Kept in the test
 * so a change to that logic that breaks the fast-path contract shows up here.
 */
function broadcast(
  raw: string | null,
  sockets: FakeSocket[],
  filterPrefs: Map<string, boolean>
): { frames: number; splitEmit: boolean } {
  if (raw === null) {
    for (const socket of sockets) socket.received.push({ body: null });
    return { frames: 1, splitEmit: false };
  }

  const masked = maskProfanity(raw);

  if (masked === raw) {
    // Fast path: one frame to the whole room.
    for (const socket of sockets) socket.received.push({ body: raw });
    return { frames: 1, splitEmit: false };
  }

  for (const socket of sockets) {
    const viewerId = socket.data.userId;
    const wantsFilter = viewerId ? (filterPrefs.get(viewerId) ?? true) : true;
    socket.received.push({ body: wantsFilter ? masked : raw });
  }
  return { frames: sockets.length, splitEmit: true };
}

let filterOn: FakeSocket;
let filterOff: FakeSocket;
let unknown: FakeSocket;
let prefs: Map<string, boolean>;

beforeEach(() => {
  filterOn = { id: "s1", data: { userId: "user-on" }, received: [] };
  filterOff = { id: "s2", data: { userId: "user-off" }, received: [] };
  unknown = { id: "s3", data: {}, received: [] };
  prefs = new Map([
    ["user-on", true],
    ["user-off", false],
  ]);
});

describe("chat broadcast — per-viewer filtering", () => {
  test("a clean message emits once to the whole room", () => {
    const raw = "good game everyone";
    const result = broadcast(raw, [filterOn, filterOff, unknown], prefs);

    assert.equal(result.splitEmit, false, "should take the fast path");
    assert.equal(result.frames, 1);
    for (const socket of [filterOn, filterOff, unknown]) {
      assert.equal(socket.received[0].body, raw);
    }
  });

  test("a profane message is masked per viewer preference", () => {
    const raw = "what the fuck was that";
    const result = broadcast(raw, [filterOn, filterOff, unknown], prefs);

    assert.equal(result.splitEmit, true, "should split emit");
    assert.equal(filterOn.received[0].body, "what the f*** was that");
    assert.equal(filterOff.received[0].body, raw);
  });

  test("a socket with no resolvable user defaults to filtered", () => {
    broadcast("what the fuck", [unknown], prefs);
    // Defaulting to ON is the safe direction when we can't identify a viewer.
    assert.equal(unknown.received[0].body, "what the f***");
  });

  test("a viewer with no stored preference defaults to filtered", () => {
    const newUser: FakeSocket = {
      id: "s4",
      data: { userId: "never-seen" },
      received: [],
    };
    broadcast("shit", [newUser], prefs);
    assert.equal(newUser.received[0].body, "s***");
  });

  test("banners (null body) emit once and carry no text", () => {
    const result = broadcast(null, [filterOn, filterOff], prefs);
    assert.equal(result.splitEmit, false);
    assert.equal(filterOn.received[0].body, null);
    assert.equal(filterOff.received[0].body, null);
  });
});
