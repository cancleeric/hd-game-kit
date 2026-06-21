/**
 * @hd/game-kit/engine — bot.
 *
 * Random-bot walk: `makeRandomMove` selects a legal move at random from the
 * current phase's allowed move set and applies it via the server-authoritative
 * `validateMove` pipeline.
 *
 * Design goals:
 *   - Pure function — zero I/O, zero side effects, no global state.
 *   - Deterministic when `rng` is injected (test-friendly; default is
 *     `Math.random` for production use).
 *   - Reuses `validateMove` so the bot's moves pass the same authority checks
 *     as a real player's moves (server-authoritative, phase-gated).
 *   - Graceful degradation: if no move succeeds (edge case — theoretically
 *     impossible when `isMoveAllowedInPhase` is in sync with `validateMove`,
 *     but guarded for safety), returns `{ ok: false, reason: 'no valid move
 *     found' }`.
 *
 * @module
 */
import type { Action, GameDefinition, MatchState } from './types.js';
/**
 * Result of {@link makeRandomMove}: a discriminated union in the engine style.
 *
 * On success it carries both the `action` that was chosen (so the caller can
 * log or broadcast it) and `nextState`, the server-recomputed match state
 * (returned from `validateMove`, identical to what a real player's move would
 * produce).
 *
 * @typeParam G - the game-specific state shape.
 */
export type BotResult<G> = {
    readonly ok: true;
    readonly action: Action;
    readonly nextState: MatchState<G>;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Pick and apply a random legal move on behalf of `playerId`.
 *
 * The bot:
 *   1. Refuses to act when the game is already over.
 *   2. Refuses to act when `playerId` is not the current player (bots only
 *      play for the current player; the caller must advance turns themselves).
 *   3. Derives the legal move ids for the current phase.
 *   4. Shuffles them with `rng` (Fisher-Yates) for an unbiased random order,
 *      then tries each via `validateMove`; returns the first successful result.
 *   5. If every candidate fails (edge case; e.g. all legal moves require a
 *      non-null payload that the bot cannot supply), returns
 *      `{ ok: false, reason: 'no valid move found' }`.
 *
 * @param def      a definition produced by `defineGame`.
 * @param match    the current match state `{ G, ctx }`.
 * @param playerId the player on whose behalf the bot acts. Must equal
 *                 `match.ctx.currentPlayer` (0-based).
 * @param rng      optional random-number generator (returns a value in [0, 1)).
 *                 Defaults to `Math.random`. Inject a seeded/fixed function in
 *                 tests to get deterministic, repeatable results.
 * @returns `{ ok: true, action, nextState }` on success, or
 *          `{ ok: false, reason }` on failure.
 */
export declare function makeRandomMove<G>(def: GameDefinition<G>, match: MatchState<G>, playerId: number, rng?: () => number): BotResult<G>;
//# sourceMappingURL=bot.d.ts.map