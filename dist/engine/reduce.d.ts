/**
 * @hd/game-kit/engine — reduce.
 *
 * The deterministic core reducer, now a full turn state machine over the
 * engine's match state `{ G, ctx }`. `reduce(def, match, action)` is a PURE
 * function: it never mutates its inputs and, given the same `(match, action)`,
 * always produces an equal result (each move must be pure — see the `MoveFn`
 * contract in types.ts).
 *
 * PR-2 scope:
 *   - operate on {@link MatchState} (`{ G, ctx }`), not bare game state;
 *   - phase gating: a move must be allowed by the current phase;
 *   - turn advancement: when an action asks to `endTurn`, advance the current
 *     player by the turn order and (if the phase declares `next`) the phase;
 *   - victory: run `def.victory(G)` after every successful move and record the
 *     result in `ctx.gameover`; once over, all further moves are rejected.
 */
import type { Action, GameDefinition, MatchState, ReduceResult } from './types.js';
/**
 * Build the initial match state for a definition.
 *
 * Constructs the engine context (player 0 to act, initial phase, no winner),
 * runs `def.setup(ctx)` to produce the initial game state, and returns
 * `{ G, ctx }`.
 *
 * @param def        a definition produced by `defineGame`.
 * @param numPlayers number of players for this match. Defaults to
 *                   `def.turn.minPlayers`. Must satisfy the definition's
 *                   `minPlayers ≤ numPlayers ≤ maxPlayers`.
 * @throws Error if `numPlayers` is out of the definition's allowed range.
 */
export declare function createMatch<G>(def: GameDefinition<G>, numPlayers?: number): MatchState<G>;
/**
 * Apply a single action to a match state via the matching move, then apply
 * engine transitions (victory, optional turn/phase advancement).
 *
 * Behaviour (first match wins; all rejections leave inputs untouched):
 *   - malformed action (no string `type`) → `{ ok: false }`.
 *   - game already over (`ctx.gameover !== null`) → `{ ok: false }`.
 *   - unknown move id → `{ ok: false }`.
 *   - move not allowed in current phase → `{ ok: false }`.
 *   - move throws → `{ ok: false }` (illegal move signalled by the move).
 *   - invalid turn-order result on `endTurn` → `{ ok: false }`.
 *   - otherwise → `{ ok: true, state: nextMatchState }`.
 *
 * The reducer never mutates `match`; immutability of `G` depends on the move
 * honouring the `MoveFn` purity contract.
 *
 * @param def    a definition produced by `defineGame`.
 * @param match  the current match state `{ G, ctx }`.
 * @param action the action to apply.
 */
export declare function reduce<G>(def: GameDefinition<G>, match: MatchState<G>, action: Action): ReduceResult<G>;
//# sourceMappingURL=reduce.d.ts.map