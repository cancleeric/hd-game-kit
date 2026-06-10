import type { RoomPlayer, RoomInfo } from './types.js';
/** Full server-side player record (includes token; never sent to clients). */
export interface ServerPlayer extends RoomPlayer {
    token: string;
}
/** Full server-side room record. */
export interface Room<TState = unknown> {
    id: string;
    players: ServerPlayer[];
    hostPlayerId: number;
    gameStarted: boolean;
    gameState: TState | null;
}
/** Structured result returned by room operations. */
export type RoomResult<T = void> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
};
/**
 * Build the public-facing RoomInfo (strips tokens and socket refs).
 */
export declare function roomSummary<TState>(room: Room<TState>): RoomInfo;
/**
 * RoomManager manages the in-memory rooms Map and exposes pure operations.
 *
 * It does NOT start a WebSocket server and does NOT depend on the `ws` package.
 * Wire it up from your server entry-point and call its methods from message
 * handlers.
 */
export declare class RoomManager<TState = unknown> {
    private readonly rooms;
    /**
     * Create a new room and add the creator as player 1 (host).
     */
    createRoom(playerName: string): RoomResult<{
        room: RoomInfo;
        playerId: number;
        playerToken: string;
    }>;
    /**
     * Join an existing room.
     *
     * If playerToken matches an existing player the join is treated as a
     * rejoin (token-based re-entry without occupying a new slot).
     */
    joinRoom(roomId: string, playerName: string, playerToken?: string): RoomResult<{
        room: RoomInfo;
        playerId: number;
        playerToken: string;
        isRejoin: boolean;
    }>;
    /**
     * Reconnect a player using their stored token.
     */
    reconnect(roomId: string, playerToken: string): RoomResult<{
        room: RoomInfo;
        playerId: number;
        playerToken: string;
        gameState: TState | null;
    }>;
    /**
     * Remove (or disconnect) a player from a room.
     *
     * - Before game start: player is fully removed; empty rooms are deleted.
     * - After game start: player is marked disconnected but kept in the room.
     *
     * Returns the updated RoomInfo, or null if the room was deleted.
     *
     * @security playerId MUST come from a server-side authenticated socket binding.
     * ⛔ Never accept playerId from C2S message payload directly.
     */
    leaveRoom(roomId: string, playerId: number): RoomResult<{
        room: RoomInfo | null;
    }>;
    /**
     * Mark a player as disconnected (e.g. WebSocket closed unexpectedly).
     *
     * Mirrors server/index.js detachSocket logic:
     * - Pre-game: remove player, possibly delete room.
     * - In-game: keep player but mark disconnected, re-elect host if needed.
     *
     * @security playerId MUST come from a server-side authenticated socket binding.
     * ⛔ Never accept playerId from C2S message payload directly.
     */
    detachPlayer(roomId: string, playerId: number): RoomResult<{
        room: RoomInfo | null;
    }>;
    getRoom(roomId: string): Room<TState> | undefined;
    getRoomCount(): number;
    /** Expose all rooms (read-only snapshot). */
    listRooms(): RoomInfo[];
    /**
     * Overwrite the in-memory game state for a room.
     *
     * @security The roomId should be resolved from a server-side authenticated
     * socket context. ⛔ Never accept roomId alone from C2S payload without
     * verifying the caller is authorised to mutate this room.
     */
    setGameState(roomId: string, gameState: TState): RoomResult<void>;
    /**
     * Attempt to start the game; only succeeds if `hostPlayerId` matches the
     * room's current host.
     *
     * @security hostPlayerId MUST come from a server-side authenticated socket
     * binding. ⛔ Never accept hostPlayerId from C2S message payload directly.
     * `state_update` authorisation (host guard) must be implemented by the
     * calling layer — this kit does not enforce it.
     */
    startGame(roomId: string, hostPlayerId: number, gameState: TState | null): RoomResult<RoomInfo>;
}
//# sourceMappingURL=RoomManager.d.ts.map