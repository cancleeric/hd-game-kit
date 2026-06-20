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
export function defineGame<G>(def: GameDefinition<G>): GameDefinition<G> {
  if (typeof def !== 'object' || def === null) {
    throw new Error('defineGame: definition must be an object');
  }

  if (typeof def.name !== 'string' || def.name.trim().length === 0) {
    throw new Error('defineGame: name must be a non-empty string');
  }

  if (typeof def.setup !== 'function') {
    throw new Error('defineGame: setup must be a function');
  }

  if (
    typeof def.moves !== 'object' ||
    def.moves === null ||
    Array.isArray(def.moves)
  ) {
    throw new Error('defineGame: moves must be a non-empty object');
  }

  const moveIds = Object.keys(def.moves);
  if (moveIds.length === 0) {
    throw new Error('defineGame: moves must be a non-empty object');
  }
  for (const id of moveIds) {
    if (typeof def.moves[id] !== 'function') {
      throw new Error(`defineGame: move "${id}" must be a function`);
    }
  }

  if (typeof def.turn !== 'object' || def.turn === null) {
    throw new Error('defineGame: turn config must be an object');
  }

  const { minPlayers, maxPlayers } = def.turn;
  if (!Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers)) {
    throw new Error('defineGame: turn.minPlayers and turn.maxPlayers must be integers');
  }
  if (minPlayers < 1) {
    throw new Error('defineGame: turn.minPlayers must be ≥ 1');
  }
  if (minPlayers > maxPlayers) {
    throw new Error('defineGame: turn.minPlayers must be ≤ turn.maxPlayers');
  }

  if (def.victory !== undefined && typeof def.victory !== 'function') {
    throw new Error('defineGame: victory must be a function when provided');
  }

  // Freeze the contract surface so the definition is immutable after creation.
  // (Game-specific state `G` is not frozen here — that is the reducer's domain.)
  Object.freeze(def.moves);
  Object.freeze(def.turn);
  return Object.freeze(def);
}
