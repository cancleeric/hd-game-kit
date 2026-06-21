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

import { validateMove } from './authority.js';
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
export type BotResult<G> =
  | { readonly ok: true; readonly action: Action; readonly nextState: MatchState<G> }
  | { readonly ok: false; readonly reason: string };

/**
 * Derive the list of move ids that are legal in the current phase.
 *
 * Mirrors the `isMoveAllowedInPhase` logic in reduce.ts (kept private there):
 *   - no phases declared (`ctx.phase === null` or `def.phases` absent) → every
 *     move in `def.moves` is allowed.
 *   - otherwise → the moves listed in `def.phases[currentPhase].moves`.
 *
 * Returns an empty array if the current phase is unknown (should not happen in
 * a well-formed definition, but the bot handles it gracefully).
 */
function legalMoveIds<G>(def: GameDefinition<G>, phase: string | null): readonly string[] {
  if (phase === null || def.phases === undefined) {
    return Object.keys(def.moves);
  }
  const phaseConfig = def.phases[phase];
  if (phaseConfig === undefined) return [];
  return phaseConfig.moves;
}

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
export function makeRandomMove<G>(
  def: GameDefinition<G>,
  match: MatchState<G>,
  playerId: number,
  rng: () => number = Math.random,
): BotResult<G> {
  // ── 1. game over guard ────────────────────────────────────────────────────
  if (match.ctx.gameover !== null) {
    return { ok: false, reason: 'game over' };
  }

  // ── 2. turn guard (bot only acts for the current player) ─────────────────
  if (playerId !== match.ctx.currentPlayer) {
    return { ok: false, reason: 'not your turn' };
  }

  // ── 3. collect legal move ids for this phase ──────────────────────────────
  const candidates = legalMoveIds(def, match.ctx.phase);

  if (candidates.length === 0) {
    return { ok: false, reason: 'no valid move found' };
  }

  // ── 4. Fisher-Yates shuffle (copy first — do not mutate `candidates`) ────
  const shuffled = candidates.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  // ── 5. try each candidate via the authority pipeline ─────────────────────
  for (const moveId of shuffled) {
    const action: Action = { type: moveId, player: playerId };
    const result = validateMove(def, match, action, playerId);
    if (result.ok) {
      return { ok: true, action, nextState: result.nextState };
    }
  }

  // ── 6. all candidates rejected (edge case) ────────────────────────────────
  return { ok: false, reason: 'no valid move found' };
}
