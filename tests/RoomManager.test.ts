import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../src/room/RoomManager.js';

describe('RoomManager', () => {
  let mgr: RoomManager;

  beforeEach(() => {
    mgr = new RoomManager();
  });

  // ── create ─────────────────────────────────────────────────────────────

  describe('createRoom', () => {
    it('creates a room and returns player id=1 with a token', () => {
      const res = mgr.createRoom('Alice');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.playerId).toBe(1);
      expect(res.value.playerToken).toHaveLength(32); // 16 bytes hex
      expect(res.value.room.hostPlayerId).toBe(1);
      expect(res.value.room.players).toHaveLength(1);
      expect(res.value.room.gameStarted).toBe(false);
    });

    it('rejects empty playerName', () => {
      const res = mgr.createRoom('   ');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/playerName/i);
    });
  });

  // ── join ───────────────────────────────────────────────────────────────

  describe('joinRoom', () => {
    it('allows a second player to join', () => {
      const created = mgr.createRoom('Alice');
      if (!created.ok) throw new Error('setup failed');
      const roomId = created.value.room.id;

      const join = mgr.joinRoom(roomId, 'Bob');
      expect(join.ok).toBe(true);
      if (!join.ok) return;
      expect(join.value.playerId).toBe(2);
      expect(join.value.isRejoin).toBe(false);
      expect(join.value.room.players).toHaveLength(2);
    });

    it('returns error for unknown room id', () => {
      const res = mgr.joinRoom('XXXXXX', 'Bob');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/not found/i);
    });

    it('rejects join when room is full (4 players)', () => {
      const created = mgr.createRoom('P1');
      if (!created.ok) throw new Error('setup failed');
      const roomId = created.value.room.id;

      mgr.joinRoom(roomId, 'P2');
      mgr.joinRoom(roomId, 'P3');
      mgr.joinRoom(roomId, 'P4');

      const overflow = mgr.joinRoom(roomId, 'P5');
      expect(overflow.ok).toBe(false);
      if (!overflow.ok) expect(overflow.error).toMatch(/full/i);
    });

    it('allows rejoin via playerToken', () => {
      const created = mgr.createRoom('Alice');
      if (!created.ok) throw new Error('setup failed');
      const { room: { id: roomId }, playerToken } = created.value;

      // Alice disconnects then rejoins with her token
      const rejoin = mgr.joinRoom(roomId, 'Alice', playerToken);
      expect(rejoin.ok).toBe(true);
      if (!rejoin.ok) return;
      expect(rejoin.value.isRejoin).toBe(true);
      expect(rejoin.value.playerId).toBe(1);
      expect(rejoin.value.playerToken).toBe(playerToken);
    });
  });

  // ── leave ──────────────────────────────────────────────────────────────

  describe('leaveRoom', () => {
    it('removes player from room pre-game and returns updated room', () => {
      const created = mgr.createRoom('Alice');
      if (!created.ok) throw new Error('setup failed');
      const { room: { id: roomId }, playerId } = created.value;

      mgr.joinRoom(roomId, 'Bob');
      const leave = mgr.leaveRoom(roomId, playerId);

      expect(leave.ok).toBe(true);
      if (!leave.ok) return;
      expect(leave.value.room).not.toBeNull();
      // Bob (id=2) becomes new host
      expect(leave.value.room!.hostPlayerId).toBe(2);
      expect(leave.value.room!.players).toHaveLength(1);
    });

    it('deletes room when last player leaves and returns null', () => {
      const created = mgr.createRoom('Solo');
      if (!created.ok) throw new Error('setup failed');
      const { room: { id: roomId }, playerId } = created.value;

      const leave = mgr.leaveRoom(roomId, playerId);
      expect(leave.ok).toBe(true);
      if (!leave.ok) return;
      expect(leave.value.room).toBeNull();
      expect(mgr.getRoomCount()).toBe(0);
    });

    it('marks player disconnected (not removed) after game starts', () => {
      const created = mgr.createRoom('Host');
      if (!created.ok) throw new Error('setup failed');
      const roomId = created.value.room.id;
      const hostId = created.value.playerId;

      mgr.joinRoom(roomId, 'Guest');
      const guestJoin = mgr.joinRoom(roomId, 'Guest2');
      if (!guestJoin.ok) throw new Error('setup failed');

      // Mark guest ready
      const room = mgr.getRoom(roomId);
      if (!room) throw new Error('no room');
      room.players.filter((p) => p.id !== hostId).forEach((p) => (p.ready = true));

      mgr.startGame(roomId, hostId, null);

      const leave = mgr.leaveRoom(roomId, guestJoin.value.playerId);
      expect(leave.ok).toBe(true);
      if (!leave.ok) return;
      // Player still in room but disconnected
      expect(leave.value.room!.players.find((p) => p.id === guestJoin.value.playerId)?.connected)
        .toBe(false);
    });
  });

  // ── reconnect ─────────────────────────────────────────────────────────

  describe('reconnect', () => {
    it('reconnects a player using their token', () => {
      const created = mgr.createRoom('Alice');
      if (!created.ok) throw new Error('setup failed');
      const { room: { id: roomId }, playerToken } = created.value;

      const res = mgr.reconnect(roomId, playerToken);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.playerId).toBe(1);
      expect(res.value.playerToken).toBe(playerToken);
    });

    it('rejects reconnect with invalid token', () => {
      const created = mgr.createRoom('Alice');
      if (!created.ok) throw new Error('setup failed');
      const roomId = created.value.room.id;

      const res = mgr.reconnect(roomId, 'deadbeef00000000deadbeef00000000');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/token/i);
    });

    it('rejects reconnect for unknown room', () => {
      const res = mgr.reconnect('XXXXXX', 'anytoken');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/not found/i);
    });
  });

  // ── startGame ─────────────────────────────────────────────────────────

  describe('startGame', () => {
    it('only host can start', () => {
      const created = mgr.createRoom('Host');
      if (!created.ok) throw new Error('setup failed');
      const roomId = created.value.room.id;
      const join = mgr.joinRoom(roomId, 'Guest');
      if (!join.ok) throw new Error('setup failed');

      const room = mgr.getRoom(roomId)!;
      room.players.find((p) => p.id === join.value.playerId)!.ready = true;

      const res = mgr.startGame(roomId, join.value.playerId, null);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/host/i);
    });

    it('needs at least 2 players', () => {
      const created = mgr.createRoom('Solo');
      if (!created.ok) throw new Error('setup failed');
      const { room: { id: roomId }, playerId } = created.value;

      const res = mgr.startGame(roomId, playerId, null);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/2 players/i);
    });
  });

  // ── detachPlayer ──────────────────────────────────────────────────────

  describe('detachPlayer', () => {
    it('reassigns host when host disconnects during game', () => {
      const created = mgr.createRoom('Host');
      if (!created.ok) throw new Error('setup failed');
      const roomId = created.value.room.id;
      const hostId = created.value.playerId;

      const joinRes = mgr.joinRoom(roomId, 'Guest');
      if (!joinRes.ok) throw new Error('setup failed');
      const guestId = joinRes.value.playerId;

      const room = mgr.getRoom(roomId)!;
      room.players.find((p) => p.id === guestId)!.ready = true;
      mgr.startGame(roomId, hostId, null);

      const detach = mgr.detachPlayer(roomId, hostId);
      expect(detach.ok).toBe(true);
      if (!detach.ok) return;
      expect(detach.value.room!.hostPlayerId).toBe(guestId);
    });
  });
});
