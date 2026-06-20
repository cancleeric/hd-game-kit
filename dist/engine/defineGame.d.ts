/**
 * @hd/game-kit/engine — defineGame.
 *
 * Validates a game definition against the engine contract and returns a frozen
 * definition. Invalid definitions throw eagerly (fail fast at module load),
 * matching boardgame.io's "define a game once, statically" shape (企劃 §5).
 *
 * PR-2 adds validation of `turn.order` and the optional `phases` map: every
 * phase's moves must exist in `def.moves`, and every `next` must point to a
 * declared phase.
 */
import type { GameDefinition } from './types.js';
/**
 * Validate and freeze a game definition.
 *
 * Contract checks (all throw `Error` on violation):
 *   - `name` is a non-empty string.
 *   - `setup` is a function.
 *   - `moves` is a non-empty object whose every value is a function.
 *   - `turn.minPlayers` and `turn.maxPlayers` are integers with
 *     `1 ≤ minPlayers ≤ maxPlayers`.
 *   - `turn.order`, if present, is `'sequential'` or a function.
 *   - `victory`, if present, is a function.
 *   - `phases`, if present, is a non-empty object where every phase declares a
 *     `moves` array of ids that all exist in `def.moves`, and any `next`
 *     references a declared phase.
 *
 * @returns the same definition, deeply frozen at the top level (`def`,
 *          `def.moves`, `def.turn`, and each phase) so callers cannot mutate
 *          the contract.
 */
export declare function defineGame<G>(def: GameDefinition<G>): GameDefinition<G>;
/**
 * The initial phase of a definition: the first key (insertion order) of
 * `def.phases`, or `null` when the game declares no phases (single implicit
 * phase, all moves allowed — PR-1 back-compat).
 */
export declare function initialPhase<G>(def: GameDefinition<G>): string | null;
//# sourceMappingURL=defineGame.d.ts.map