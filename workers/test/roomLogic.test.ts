import { describe, it, expect, beforeEach } from "vitest";

import { RoomHub } from "../src/roomLogic";

interface Captured {
  t: string;
  a: unknown[];
}

const makePeer = () => {
  const sent: Captured[] = [];
  return {
    sent,
    send: (env: { t: string; a: unknown[] }) => sent.push(env),
  };
};

describe("RoomHub", () => {
  let hub: RoomHub;
  beforeEach(() => {
    hub = new RoomHub();
  });

  it("emits init-room when a peer connects", () => {
    const a = makePeer();
    hub.addPeer("a", a.send);
    expect(a.sent).toEqual([{ t: "init-room", a: [] }]);
  });

  it("first joiner gets first-in-room", () => {
    const a = makePeer();
    hub.addPeer("a", a.send);
    a.sent.length = 0;

    hub.joinRoom("a", "room1");
    const types = a.sent.map((e) => e.t);
    expect(types).toContain("first-in-room");
    expect(types).toContain("room-user-change");
    const change = a.sent.find((e) => e.t === "room-user-change")!;
    expect(change.a[0]).toEqual(["a"]);
  });

  it("second joiner triggers new-user to existing peer", () => {
    const a = makePeer();
    const b = makePeer();
    hub.addPeer("a", a.send);
    hub.addPeer("b", b.send);
    hub.joinRoom("a", "room1");
    a.sent.length = 0;
    b.sent.length = 0;

    hub.joinRoom("b", "room1");

    // existing peer is told about the new user
    expect(a.sent.find((e) => e.t === "new-user")?.a).toEqual(["b"]);
    // newcomer is NOT told first-in-room
    expect(b.sent.find((e) => e.t === "first-in-room")).toBeUndefined();
    // both get an updated room-user-change
    const aChange = a.sent.find((e) => e.t === "room-user-change");
    const bChange = b.sent.find((e) => e.t === "room-user-change");
    expect(aChange).toBeDefined();
    expect(bChange).toBeDefined();
    expect((aChange!.a[0] as string[]).sort()).toEqual(["a", "b"]);
  });

  it("relayBroadcast forwards to others, not the sender", () => {
    const a = makePeer();
    const b = makePeer();
    const c = makePeer();
    hub.addPeer("a", a.send);
    hub.addPeer("b", b.send);
    hub.addPeer("c", c.send);
    hub.joinRoom("a", "room1");
    hub.joinRoom("b", "room1");
    hub.joinRoom("c", "room1");
    a.sent.length = 0;
    b.sent.length = 0;
    c.sent.length = 0;

    const buf = new Uint8Array([7, 8, 9]);
    const iv = new Uint8Array([1, 2, 3]);
    hub.relayBroadcast("a", "room1", buf, iv);

    expect(a.sent.find((e) => e.t === "client-broadcast")).toBeUndefined();
    const bMsg = b.sent.find((e) => e.t === "client-broadcast");
    const cMsg = c.sent.find((e) => e.t === "client-broadcast");
    expect(bMsg).toBeDefined();
    expect(cMsg).toBeDefined();
    expect(bMsg!.a[0]).toEqual(buf);
    expect(bMsg!.a[1]).toEqual(iv);
  });

  it("relayBroadcast ignores peers not in the room", () => {
    const a = makePeer();
    const b = makePeer();
    hub.addPeer("a", a.send);
    hub.addPeer("b", b.send);
    hub.joinRoom("a", "room1");
    hub.joinRoom("b", "room2");
    b.sent.length = 0;
    hub.relayBroadcast("a", "room1", new Uint8Array(), new Uint8Array());
    expect(b.sent).toEqual([]);
  });

  it("removePeer updates room-user-change for remaining peers", () => {
    const a = makePeer();
    const b = makePeer();
    hub.addPeer("a", a.send);
    hub.addPeer("b", b.send);
    hub.joinRoom("a", "room1");
    hub.joinRoom("b", "room1");
    b.sent.length = 0;

    hub.removePeer("a");
    const change = b.sent.find((e) => e.t === "room-user-change");
    expect(change).toBeDefined();
    expect(change!.a[0]).toEqual(["b"]);
  });

  it("user-follow sends user-follow-room-change to the followee", () => {
    const a = makePeer();
    const b = makePeer();
    hub.addPeer("a", a.send);
    hub.addPeer("b", b.send);
    hub.joinRoom("a", "room1");
    hub.joinRoom("b", "room1");
    b.sent.length = 0;

    hub.userFollow("a", {
      userToFollow: { socketId: "b", username: "x" },
      action: "FOLLOW",
    });
    const ev = b.sent.find((e) => e.t === "user-follow-room-change");
    expect(ev).toBeDefined();
    expect(ev!.a[0]).toEqual(["a"]);

    hub.userFollow("a", {
      userToFollow: { socketId: "b", username: "x" },
      action: "UNFOLLOW",
    });
    const last = b.sent.filter((e) => e.t === "user-follow-room-change").pop();
    expect(last!.a[0]).toEqual([]);
  });

  it("disconnect cleans up follower entries", () => {
    const a = makePeer();
    const b = makePeer();
    hub.addPeer("a", a.send);
    hub.addPeer("b", b.send);
    hub.joinRoom("a", "room1");
    hub.joinRoom("b", "room1");
    hub.userFollow("a", {
      userToFollow: { socketId: "b" },
      action: "FOLLOW",
    });
    b.sent.length = 0;

    hub.removePeer("a");
    const ev = b.sent.find((e) => e.t === "user-follow-room-change");
    expect(ev).toBeDefined();
    expect(ev!.a[0]).toEqual([]);
  });

  it("rejoining moves the peer between rooms", () => {
    const a = makePeer();
    hub.addPeer("a", a.send);
    hub.joinRoom("a", "r1");
    hub.joinRoom("a", "r2");
    expect(hub.roomMembers("r1")).toEqual([]);
    expect(hub.roomMembers("r2")).toEqual(["a"]);
  });
});
