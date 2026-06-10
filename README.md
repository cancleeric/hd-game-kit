# @hd/game-kit

HurricaneDigital shared game development kit — transport and room management utilities for multiplayer web games.

## Installation

```
npm install @hd/game-kit
```

## Subpaths

| Subpath | Contents | Runtime |
|---------|----------|---------|
| `@hd/game-kit` | `WsTransport`, `ITransport`, room types | Browser / Node |
| `@hd/game-kit/server` | `RoomManager`, `roomSummary`, all types | Node.js only |

## Modules

### WsTransport (browser)

Browser-side WebSocket client with automatic exponential-backoff reconnection.

```ts
import { WsTransport } from '@hd/game-kit';

const transport = new WsTransport();
transport.setReconnectIdentity(roomId, playerToken);
transport.connect('wss://your-server/ws');
transport.onMessage((msg) => { /* handle */ });
transport.send({ type: 'ready' });
```

`connect(url)` — `url` must be a server-controlled trusted value; never derive it from user input or C2S payload.

### RoomManager (server)

Server-side in-memory room lifecycle manager. Depends on `node:crypto` — import from the `/server` subpath only.

```ts
import { RoomManager } from '@hd/game-kit/server';

const mgr = new RoomManager();

// Host creates a room
const result = mgr.createRoom('Alice');
// result.value.playerToken  — unicast to Alice's socket only

// Second player joins
mgr.joinRoom(roomId, 'Bob');

// Start the game
mgr.startGame(roomId, hostPlayerId, initialState);
```

## Security

### playerId trust assumption

`RoomManager` methods that accept a `playerId` parameter (`leaveRoom`, `startGame`, `setGameState`, `detachPlayer`) **must receive a value that originates from the server-side authenticated socket binding**, not from a C2S message payload.

Typical correct pattern:

```ts
// Server associates the authenticated playerId with the socket at join time.
const playerIdForSocket = new Map<WebSocket, number>();

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  // CORRECT: read playerId from the server-side map
  const playerId = playerIdForSocket.get(ws)!;
  mgr.leaveRoom(msg.roomId, playerId);

  // WRONG — never do this:
  // mgr.leaveRoom(msg.roomId, msg.playerId);
});
```

### playerToken single-cast rule

`createRoom`, `joinRoom`, and `reconnect` all return a `playerToken` in their result value.  This token is a 16-byte cryptographically random credential generated via `node:crypto` (server-side only).

- Send it only as a **unicast** response to the requesting connection.
- **Never broadcast** it to other players or include it in `state_update` / room-info messages.

### state_update host authorisation

`RoomManager.startGame` verifies that the caller's `hostPlayerId` matches the room's current host.  All other host-gated actions (e.g. `state_update`) must be guarded by the **calling layer** — this kit does not enforce them.

### WsTransport connect URL

`WsTransport.connect(url)` accepts any string.  The `url` value must always be a **server-controlled trusted value** (hard-coded or fetched from a trusted config endpoint).  Do not derive it from user input or from a C2S message payload.

### Duplicate player names

Multiple players with the same display name in one room is intentional and allowed by design.  Each player has a unique numeric `id` and `token`.  Games that need unique names must enforce that constraint in their own calling layer.

## Development

```bash
npm run build   # tsc -b
npm test        # vitest run
```
