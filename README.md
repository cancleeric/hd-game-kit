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
| `@hd/game-kit/engine` | `defineGame`, `createMatch`, `reduce`, `validateMove` (deterministic rules engine) | Browser / Node |

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

### Game engine (`@hd/game-kit/engine`)

A deterministic, pure-function rules engine in the boardgame.io shape: a game is
a module of `setup + moves + turn + phases + victory`. The engine operates on a
match state `{ G, ctx }` — `G` is your pure game state, `ctx` is engine-managed
turn / phase / victory metadata. It is browser-safe (no `node:crypto`, no I/O).

```ts
import { defineGame, createMatch, reduce, validateMove } from '@hd/game-kit/engine';
import type { MoveFn } from '@hd/game-kit/engine';

interface TicTacToeState {
  readonly board: ReadonlyArray<number | null>; // cell → owning player index, or null
  readonly placed: number;
}

// A move is a PURE function (state, ctx, payload) → NEW state.
// ⛔ It MUST NOT mutate its inputs. Throw to signal an illegal move.
const place: MoveFn<TicTacToeState> = (state, ctx, payload) => {
  const cell = payload as number;
  if (cell < 0 || cell >= 9) throw new Error('cell out of range');
  if (state.board[cell] !== null) throw new Error('cell already occupied');
  const board = state.board.slice();
  board[cell] = ctx.currentPlayer; // whose turn it is comes from ctx, not payload
  return { board, placed: state.placed + 1 };
};

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6],
  [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
] as const;

const game = defineGame<TicTacToeState>({
  name: 'tic-tac-toe',
  setup: () => ({ board: Array(9).fill(null), placed: 0 }),
  moves: { place },
  turn: { minPlayers: 2, maxPlayers: 2, order: 'sequential' },
  // Optional phases gate which moves are legal when:
  phases: { play: { moves: ['place'] } },
  // victory runs after every move; a non-null result ends the game.
  victory: (s) => {
    for (const [a, b, c] of LINES) {
      const v = s.board[a];
      if (v !== null && v === s.board[b] && v === s.board[c]) return v;
    }
    return s.board.every((c) => c !== null) ? 'draw' : null;
  },
});

// Build the initial match, then advance it.
let match = createMatch(game, 2);

// Client-side / local: reduce applies a move and returns the next match state.
// `events.endTurn` advances the current player by the turn order.
const r = reduce(game, match, { type: 'place', payload: 0, events: { endTurn: true } });
if (r.ok) match = r.state; // r.state.ctx.currentPlayer is now 1; r.state.ctx.gameover holds the winner once decided

// Server-authoritative: validateMove re-runs the move from the SERVER-held
// match and checks the acting player. `playerId` MUST come from the
// authenticated socket binding, never from client input.
const v = validateMove(game, match, { type: 'place', payload: 1 }, /* playerId */ 1);
// v.ok === false with reason 'not your turn' / 'player spoof' on a bad actor;
// v.ok === true with v.nextState (recomputed on the server) otherwise.
```

A complete, runnable version of this game lives at
`tests/engine/fixtures/tic-tac-toe.ts`, exercised end to end by
`tests/engine/e2e-engine.test.ts`.

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
