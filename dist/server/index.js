/**
 * @hd/game-kit/server — Node.js server-only subpath.
 *
 * Contains RoomManager and roomSummary which depend on node:crypto.
 * Import this from your server entry-point only.
 *
 * @example
 *   import { RoomManager, roomSummary } from '@hd/game-kit/server';
 */
// Server-side room management (node:crypto dependency)
export { RoomManager, roomSummary } from '../room/RoomManager.js';
//# sourceMappingURL=index.js.map