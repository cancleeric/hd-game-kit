/**
 * @hd/game-kit/engine — public API.
 *
 * Deterministic, pure-function game engine (boardgame.io shape, 企劃 §5).
 * Browser-safe: no node:crypto / no I/O. Import from '@hd/game-kit/engine'.
 *
 * The engine operates on a match state `{ G, ctx }`: `G` is the pure, game-
 * specific domain state; `ctx` is engine-managed turn / phase / victory
 * metadata. `createMatch` builds the initial match state; `reduce` advances it.
 *
 * @example
 *   import { defineGame, createMatch, reduce } from '@hd/game-kit/engine';
 *
 *   const game = defineGame<{ count: number }>({
 *     name: 'counter',
 *     setup: () => ({ count: 0 }),
 *     moves: {
 *       inc: (s) => ({ count: s.count + 1 }),
 *     },
 *     turn: { minPlayers: 1, maxPlayers: 2, order: 'sequential' },
 *   });
 *
 *   let match = createMatch(game, 2);
 *   const r = reduce(game, match, { type: 'inc', events: { endTurn: true } });
 *   // r.ok === true, r.state.G.count === 1, r.state.ctx.currentPlayer === 1
 */

export { defineGame, initialPhase } from './defineGame.js';
export { createMatch, reduce } from './reduce.js';
export { validateMove } from './authority.js';
export { nextPlayer, TurnOrderError } from './turnOrder.js';
export { filterView, hasHiddenInfo } from './hiddenInfo.js';
export type {
  Action,
  ActionEvents,
  GameContext,
  GameDefinition,
  MaskedState,
  MatchState,
  MoveFn,
  PhaseConfig,
  ReduceResult,
  TurnConfig,
  TurnOrder,
} from './types.js';
export type { ValidateResult } from './authority.js';
