/**
 * @hd/game-kit/server — Node.js server-only subpath.
 *
 * Contains RoomManager and roomSummary which depend on node:crypto.
 * Import this from your server entry-point only.
 *
 * @example
 *   import { RoomManager, roomSummary } from '@hd/game-kit/server';
 */
export type { RoomPlayer, RoomInfo, ClientToServerMessage, ServerToClientMessage, } from '../room/types.js';
export { RoomManager, roomSummary } from '../room/RoomManager.js';
export type { ServerPlayer, Room, RoomResult } from '../room/RoomManager.js';
//# sourceMappingURL=index.d.ts.map