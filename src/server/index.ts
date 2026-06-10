/**
 * @hd/game-kit/server — Node.js server-only subpath.
 *
 * Contains RoomManager and roomSummary which depend on node:crypto.
 * Import this from your server entry-point only.
 *
 * @example
 *   import { RoomManager, roomSummary } from '@hd/game-kit/server';
 */

// Re-export room types (shared with browser)
export type {
  RoomPlayer,
  RoomInfo,
  ClientToServerMessage,
  ServerToClientMessage,
} from '../room/types.js';

// Server-side room management (node:crypto dependency)
export { RoomManager, roomSummary } from '../room/RoomManager.js';
export type { ServerPlayer, Room, RoomResult } from '../room/RoomManager.js';
