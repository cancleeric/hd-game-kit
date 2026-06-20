/**
 * @hd/game-kit/engine — reduce.
 *
 * The deterministic core reducer. `reduce(def, state, action)` is a PURE
 * function: it does not mutate its inputs and, given the same `(state, action)`,
 * always produces an equal result (the move itself must be pure — see the
 * `MoveFn` contract in types.ts).
 *
 * PR-1 scope: dispatch one move and return the new state. No phase gating, no
 * turn advancement, no victory wiring (those are PR-2).
 */
import type { Action, GameContext, GameDefinition, ReduceResult } from './types.js';
/**
 * Apply a single action to a state via the matching move.
 *
 * Behaviour:
 *   - If `action.type` does not match a move id → `{ ok: false, error }`.
 *   - If the move throws → `{ ok: false, error }` (illegal move signalled by
 *     the move itself).
 *   - Otherwise → `{ ok: true, state: <move's returned state> }`.
 *
 * The reducer never mutates `state`; correctness of immutability depends on the
 * move honouring the `MoveFn` purity contract.
 *
 * @param def    a definition produced by `defineGame`.
 * @param state  the current game state.
 * @param action the action to apply.
 * @param ctx    optional engine context; defaults to `{ numPlayers: minPlayers }`.
 */
export declare function reduce<G>(def: GameDefinition<G>, state: G, action: Action, ctx?: GameContext): ReduceResult<G>;
//# sourceMappingURL=reduce.d.ts.map