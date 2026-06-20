/**
 * @hd/game-kit/engine — public API.
 *
 * Deterministic, pure-function game engine (boardgame.io shape, 企劃 §5).
 * Browser-safe: no node:crypto / no I/O. Import from '@hd/game-kit/engine'.
 *
 * @example
 *   import { defineGame, reduce } from '@hd/game-kit/engine';
 *
 *   const game = defineGame<{ count: number }>({
 *     name: 'counter',
 *     setup: () => ({ count: 0 }),
 *     moves: {
 *       inc: (s) => ({ count: s.count + 1 }),
 *     },
 *     turn: { minPlayers: 1, maxPlayers: 1 },
 *   });
 *
 *   const r = reduce(game, { count: 0 }, { type: 'inc' });
 *   // r.ok === true, r.state.count === 1
 */
export { defineGame } from './defineGame.js';
export { reduce } from './reduce.js';
//# sourceMappingURL=index.js.map