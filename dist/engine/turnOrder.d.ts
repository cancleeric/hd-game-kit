/**
 * @hd/game-kit/engine — turn order.
 *
 * Pure, deterministic turn-order strategies. Given the post-move engine
 * context, compute the index of the player whose turn comes next.
 *
 *   - `'sequential'`: `(currentPlayer + 1) mod numPlayers` — wraps back to
 *     player 0 after the last player.
 *   - a function `(ctx) => number`: a game-supplied pure selector.
 *
 * The result MUST be an integer in `[0, numPlayers)`. A strategy that returns
 * an out-of-range or non-integer value is a contract violation; callers
 * surface it as a rejected move rather than corrupting the match state.
 */
import type { GameContext, TurnOrder } from './types.js';
/** Thrown when a turn-order strategy yields an invalid player index. */
export declare class TurnOrderError extends Error {
    constructor(message: string);
}
/**
 * Compute the next player index from the current context using the given
 * strategy. Pure: depends only on `ctx` and `order`.
 *
 * @param ctx   the engine context AFTER the move's state change (but before the
 *              turn advances). `ctx.currentPlayer` is the player who just acted.
 * @param order the strategy; `'sequential'` when omitted/undefined.
 * @returns the next player index, an integer in `[0, ctx.numPlayers)`.
 * @throws TurnOrderError if a function strategy returns an invalid index.
 */
export declare function nextPlayer(ctx: GameContext, order?: TurnOrder): number;
//# sourceMappingURL=turnOrder.d.ts.map