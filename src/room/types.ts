/**
 * room/types.ts — generic, game-agnostic room/player types and message frames.
 *
 * Each game specialises the payload by supplying its own TAction and TState
 * type parameters.  No kingdom-specific types appear here.
 */

// ── Core entities ────────────────────────────────────────────────────────────

export interface RoomPlayer {
  /** 1-based sequential player ID assigned by the server. */
  id: number;
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface RoomInfo {
  id: string;
  hostPlayerId: number;
  gameStarted: boolean;
  players: RoomPlayer[];
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

// ── Client → Server messages ─────────────────────────────────────────────────

/**
 * Generic C2S message union.
 *
 * TAction: game-specific player action shape
 * TState:  game-specific serialisable game state
 */
export type ClientToServerMessage<TAction = unknown, TState = unknown> =
  | { type: 'create_room'; playerName: string }
  | { type: 'join_room'; roomId: string; playerName: string; playerToken?: string }
  | { type: 'reconnect'; roomId: string; playerToken: string }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'leave_room' }
  | { type: 'start_game'; gameState: TState }
  | { type: 'state_update'; gameState: TState }
  | { type: 'player_action'; action: TAction };

// ── Server → Client messages ─────────────────────────────────────────────────

/**
 * Generic S2C message union.
 *
 * TAction: game-specific player action shape
 * TState:  game-specific serialisable game state
 */
export type ServerToClientMessage<TAction = unknown, TState = unknown> =
  | { type: 'connected' }
  | {
      type: 'room_created';
      room: RoomInfo;
      yourPlayerId: number;
      yourPlayerToken: string;
    }
  | {
      type: 'room_joined';
      room: RoomInfo;
      yourPlayerId: number;
      yourPlayerToken: string;
      gameState: TState | null;
    }
  | { type: 'room_update'; room: RoomInfo }
  | { type: 'game_started'; room: RoomInfo; gameState: TState | null }
  | { type: 'state_update'; gameState: TState | null }
  | { type: 'action_request'; playerId: number; action: TAction }
  | { type: 'error'; message: string };
