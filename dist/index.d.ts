/**
 * @hd/game-kit — browser-safe root export.
 *
 * Contains transport types and browser-side WebSocket client.
 * Does NOT export RoomManager (node:crypto dependency).
 * Server-side: import from '@hd/game-kit/server'.
 */
export type { ITransport, ConnectionStatus } from './transport/ITransport.js';
export { WsTransport } from './transport/WsTransport.js';
export type { RoomPlayer, RoomInfo, ClientToServerMessage, ServerToClientMessage, } from './room/types.js';
export type { ServerPlayer, Room, RoomResult } from './room/RoomManager.js';
//# sourceMappingURL=index.d.ts.map