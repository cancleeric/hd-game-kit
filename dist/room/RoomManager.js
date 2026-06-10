import { randomBytes } from 'node:crypto';
const MAX_PLAYERS = 4;
const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// ── Helpers ───────────────────────────────────────────────────────────────────
function randomToken() {
    return randomBytes(16).toString('hex');
}
function randomRoomId() {
    let id = '';
    for (let i = 0; i < 6; i += 1) {
        id += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
    }
    return id;
}
function firstAvailablePlayerId(players) {
    for (let id = 1; id <= MAX_PLAYERS; id += 1) {
        if (!players.some((p) => p.id === id))
            return id;
    }
    return null;
}
/**
 * Build the public-facing RoomInfo (strips tokens and socket refs).
 */
export function roomSummary(room) {
    return {
        id: room.id,
        hostPlayerId: room.hostPlayerId,
        gameStarted: room.gameStarted,
        players: room.players
            .slice()
            .sort((a, b) => a.id - b.id)
            .map((p) => ({
            id: p.id,
            name: p.name,
            ready: p.ready,
            connected: p.connected,
        })),
    };
}
// ── RoomManager ───────────────────────────────────────────────────────────────
/**
 * RoomManager manages the in-memory rooms Map and exposes pure operations.
 *
 * It does NOT start a WebSocket server and does NOT depend on the `ws` package.
 * Wire it up from your server entry-point and call its methods from message
 * handlers.
 */
export class RoomManager {
    rooms = new Map();
    // ── Room lifecycle ──────────────────────────────────────────────────────
    /**
     * Create a new room and add the creator as player 1 (host).
     */
    createRoom(playerName) {
        const trimmedName = playerName.trim();
        if (!trimmedName) {
            return { ok: false, error: 'playerName is required.' };
        }
        let id = randomRoomId();
        while (this.rooms.has(id))
            id = randomRoomId();
        const token = randomToken();
        const player = {
            id: 1,
            name: trimmedName,
            ready: false,
            connected: true,
            token,
        };
        const room = {
            id,
            players: [player],
            hostPlayerId: 1,
            gameStarted: false,
            gameState: null,
        };
        this.rooms.set(id, room);
        return {
            ok: true,
            value: {
                room: roomSummary(room),
                playerId: player.id,
                playerToken: token,
            },
        };
    }
    /**
     * Join an existing room.
     *
     * If playerToken matches an existing player the join is treated as a
     * rejoin (token-based re-entry without occupying a new slot).
     */
    joinRoom(roomId, playerName, playerToken) {
        const room = this.rooms.get(roomId.toUpperCase());
        if (!room) {
            return { ok: false, error: 'Room not found.' };
        }
        const trimmedName = playerName.trim();
        if (!trimmedName) {
            return { ok: false, error: 'playerName is required.' };
        }
        // Token-based rejoin
        if (playerToken) {
            const existing = room.players.find((p) => p.token === playerToken);
            if (existing) {
                existing.connected = true;
                return {
                    ok: true,
                    value: {
                        room: roomSummary(room),
                        playerId: existing.id,
                        playerToken: existing.token,
                        isRejoin: true,
                    },
                };
            }
        }
        if (room.gameStarted) {
            return { ok: false, error: 'Game already started.' };
        }
        const id = firstAvailablePlayerId(room.players);
        if (id === null) {
            return { ok: false, error: 'Room is full.' };
        }
        const token = randomToken();
        const player = {
            id,
            name: trimmedName,
            ready: false,
            connected: true,
            token,
        };
        room.players.push(player);
        return {
            ok: true,
            value: {
                room: roomSummary(room),
                playerId: player.id,
                playerToken: token,
                isRejoin: false,
            },
        };
    }
    /**
     * Reconnect a player using their stored token.
     */
    reconnect(roomId, playerToken) {
        const room = this.rooms.get(roomId.toUpperCase());
        if (!room) {
            return { ok: false, error: 'Room not found for reconnect.' };
        }
        const player = room.players.find((p) => p.token === playerToken);
        if (!player) {
            return { ok: false, error: 'Reconnect token invalid.' };
        }
        player.connected = true;
        return {
            ok: true,
            value: {
                room: roomSummary(room),
                playerId: player.id,
                playerToken: player.token,
                gameState: room.gameState,
            },
        };
    }
    /**
     * Remove (or disconnect) a player from a room.
     *
     * - Before game start: player is fully removed; empty rooms are deleted.
     * - After game start: player is marked disconnected but kept in the room.
     *
     * Returns the updated RoomInfo, or null if the room was deleted.
     */
    leaveRoom(roomId, playerId) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return { ok: false, error: 'Room not found.' };
        }
        const player = room.players.find((p) => p.id === playerId);
        if (!player) {
            return { ok: false, error: 'Player not found in room.' };
        }
        if (!room.gameStarted) {
            room.players = room.players.filter((p) => p.id !== playerId);
        }
        else {
            player.connected = false;
        }
        if (room.players.length === 0) {
            this.rooms.delete(room.id);
            return { ok: true, value: { room: null } };
        }
        if (room.hostPlayerId === playerId) {
            const next = room.players.slice().sort((a, b) => a.id - b.id)[0];
            // next is guaranteed to exist because players.length > 0
            room.hostPlayerId = next.id;
        }
        return { ok: true, value: { room: roomSummary(room) } };
    }
    // ── Socket disconnect (passive leave) ──────────────────────────────────
    /**
     * Mark a player as disconnected (e.g. WebSocket closed unexpectedly).
     *
     * Mirrors server/index.js detachSocket logic:
     * - Pre-game: remove player, possibly delete room.
     * - In-game: keep player but mark disconnected, re-elect host if needed.
     */
    detachPlayer(roomId, playerId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return { ok: false, error: 'Room not found.' };
        const player = room.players.find((p) => p.id === playerId);
        if (!player)
            return { ok: false, error: 'Player not found.' };
        player.connected = false;
        if (!room.gameStarted) {
            room.players = room.players.filter((p) => p.id !== playerId);
            if (room.players.length === 0) {
                this.rooms.delete(room.id);
                return { ok: true, value: { room: null } };
            }
            if (room.hostPlayerId === playerId) {
                const next = room.players.slice().sort((a, b) => a.id - b.id)[0];
                room.hostPlayerId = next.id;
            }
        }
        else if (room.hostPlayerId === playerId) {
            const replacement = room.players
                .slice()
                .sort((a, b) => a.id - b.id)
                .find((p) => p.connected);
            if (replacement) {
                room.hostPlayerId = replacement.id;
            }
        }
        return { ok: true, value: { room: roomSummary(room) } };
    }
    // ── Queries ─────────────────────────────────────────────────────────────
    getRoom(roomId) {
        return this.rooms.get(roomId.toUpperCase());
    }
    getRoomCount() {
        return this.rooms.size;
    }
    /** Expose all rooms (read-only snapshot). */
    listRooms() {
        return Array.from(this.rooms.values()).map(roomSummary);
    }
    // ── Game state ──────────────────────────────────────────────────────────
    setGameState(roomId, gameState) {
        const room = this.rooms.get(roomId);
        if (!room)
            return { ok: false, error: 'Room not found.' };
        room.gameState = gameState;
        return { ok: true, value: undefined };
    }
    startGame(roomId, hostPlayerId, gameState) {
        const room = this.rooms.get(roomId);
        if (!room)
            return { ok: false, error: 'Room not found.' };
        if (room.hostPlayerId !== hostPlayerId) {
            return { ok: false, error: 'Only host can start the game.' };
        }
        if (room.players.length < 2) {
            return { ok: false, error: 'At least 2 players are required.' };
        }
        const allReady = room.players.every((p) => p.ready || p.id === room.hostPlayerId);
        if (!allReady) {
            return { ok: false, error: 'All non-host players must be ready.' };
        }
        room.gameStarted = true;
        room.gameState = gameState;
        return { ok: true, value: roomSummary(room) };
    }
}
//# sourceMappingURL=RoomManager.js.map