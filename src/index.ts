/**
 * @hd/game-kit — browser-safe root export.
 *
 * Contains transport types and browser-side WebSocket client.
 * Does NOT export RoomManager (node:crypto dependency).
 * Server-side: import from '@hd/game-kit/server'.
 */

// Transport
export type { ITransport, ConnectionStatus } from './transport/ITransport.js';
export { WsTransport } from './transport/WsTransport.js';

// Room types (browser-safe — no node:crypto)
export type {
  RoomPlayer,
  RoomInfo,
  ClientToServerMessage,
  ServerToClientMessage,
} from './room/types.js';

// Server-side types re-exported for convenience (type-only, no runtime cost)
export type { ServerPlayer, Room, RoomResult } from './room/RoomManager.js';
