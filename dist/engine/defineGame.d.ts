/**
 * @hd/game-kit/engine — defineGame.
 *
 * Validates a game definition against the engine contract and returns a frozen
 * definition. Invalid definitions throw eagerly (fail fast at module load),
 * matching boardgame.io's "define a game once, statically" shape (企劃 §5).
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
 *   - `victory`, if present, is a function.
 *
 * @returns the same definition, deeply frozen at the top level (`def`,
 *          `def.moves`, `def.turn`) so callers cannot mutate the contract.
 */
export declare function defineGame<G>(def: GameDefinition<G>): GameDefinition<G>;
//# sourceMappingURL=defineGame.d.ts.map