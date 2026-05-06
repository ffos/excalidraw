/**
 * Pure protocol logic for a collab room, factored out of the Durable Object
 * for testability. The DO is a thin transport wrapper around this.
 *
 * Mirrors the excalidraw-room (Socket.io) protocol:
 *
 *   client → server:
 *     join-room                   (roomId)
 *     server-broadcast            (roomId, encryptedBuffer, iv)
 *     server-volatile-broadcast   (roomId, encryptedBuffer, iv)
 *     user-follow                 (payload)
 *
 *   server → client:
 *     init-room                   ()
 *     new-user                    (socketId)
 *     room-user-change            (socketIds[])
 *     client-broadcast            (encryptedBuffer, iv)
 *     first-in-room               ()
 *     user-follow-room-change     (followedBy[])
 */

export type Send = (envelope: { t: string; a: unknown[] }) => void;

interface Peer {
  socketId: string;
  roomId: string | null;
  send: Send;
  // followers tracked per peer for user-follow fan-out
  followers: Set<string>;
}

export class RoomHub {
  // socketId -> peer
  private peers = new Map<string, Peer>();
  // roomId -> set of socketIds
  private rooms = new Map<string, Set<string>>();

  addPeer(socketId: string, send: Send): void {
    if (this.peers.has(socketId)) {
      throw new Error(`peer already exists: ${socketId}`);
    }
    this.peers.set(socketId, {
      socketId,
      roomId: null,
      send,
      followers: new Set(),
    });
    // Tell the client to start the join handshake — same as excalidraw-room.
    send({ t: "init-room", a: [] });
  }

  removePeer(socketId: string): void {
    const peer = this.peers.get(socketId);
    if (!peer) {
      return;
    }
    if (peer.roomId) {
      const room = this.rooms.get(peer.roomId);
      if (room) {
        room.delete(socketId);
        if (room.size === 0) {
          this.rooms.delete(peer.roomId);
        } else {
          this.broadcastRoomChange(peer.roomId);
        }
      }
    }
    // Tell anyone they were following that they lost a follower.
    for (const otherId of this.peers.keys()) {
      const other = this.peers.get(otherId);
      if (other && other.followers.delete(socketId)) {
        other.send({ t: "user-follow-room-change", a: [[...other.followers]] });
      }
    }
    this.peers.delete(socketId);
  }

  joinRoom(socketId: string, roomId: string): void {
    const peer = this.peers.get(socketId);
    if (!peer) {
      return;
    }
    if (peer.roomId) {
      // already in a room — leave silently first
      const old = this.rooms.get(peer.roomId);
      if (old) {
        old.delete(socketId);
        if (old.size === 0) {
          this.rooms.delete(peer.roomId);
        } else {
          this.broadcastRoomChange(peer.roomId);
        }
      }
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Set();
      this.rooms.set(roomId, room);
    }
    const wasEmpty = room.size === 0;
    room.add(socketId);
    peer.roomId = roomId;

    if (wasEmpty) {
      // Lone joiner — let the client know it should fetch persisted scene.
      peer.send({ t: "first-in-room", a: [] });
    } else {
      // Tell existing peers about the new arrival so they sync the scene.
      for (const otherId of room) {
        if (otherId === socketId) continue;
        const other = this.peers.get(otherId);
        other?.send({ t: "new-user", a: [socketId] });
      }
    }
    this.broadcastRoomChange(roomId);
  }

  /** Relay an encrypted scene update to everyone else in the room. */
  relayBroadcast(
    socketId: string,
    roomId: string,
    encryptedBuffer: Uint8Array,
    iv: Uint8Array,
  ): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.has(socketId)) {
      return;
    }
    for (const otherId of room) {
      if (otherId === socketId) continue;
      const other = this.peers.get(otherId);
      other?.send({ t: "client-broadcast", a: [encryptedBuffer, iv] });
    }
  }

  /** "user-follow" toggles whether socketId follows payload.userToFollow. */
  userFollow(
    socketId: string,
    payload: {
      userToFollow: { socketId: string; username?: string };
      action: "FOLLOW" | "UNFOLLOW";
    },
  ): void {
    const target = this.peers.get(payload.userToFollow.socketId);
    if (!target) {
      return;
    }
    if (payload.action === "FOLLOW") {
      target.followers.add(socketId);
    } else {
      target.followers.delete(socketId);
    }
    target.send({
      t: "user-follow-room-change",
      a: [[...target.followers]],
    });
  }

  private broadcastRoomChange(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }
    const ids = [...room];
    for (const id of room) {
      const peer = this.peers.get(id);
      peer?.send({ t: "room-user-change", a: [ids] });
    }
  }

  // --- introspection helpers used by tests --------------------------------

  /** @internal */
  hasPeer(socketId: string): boolean {
    return this.peers.has(socketId);
  }

  /** @internal */
  roomMembers(roomId: string): string[] {
    return [...(this.rooms.get(roomId) ?? [])];
  }

  /** @internal */
  peerCount(): number {
    return this.peers.size;
  }
}
