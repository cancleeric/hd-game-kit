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

  const { minPlayers, maxPlayers, order } = def.turn;
  if (!Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers)) {
    throw new Error('defineGame: turn.minPlayers and turn.maxPlayers must be integers');
  }
  if (minPlayers < 1) {
    throw new Error('defineGame: turn.minPlayers must be ≥ 1');
  }
  if (minPlayers > maxPlayers) {
    throw new Error('defineGame: turn.minPlayers must be ≤ turn.maxPlayers');
  }

  if (order !== undefined && order !== 'sequential' && typeof order !== 'function') {
    throw new Error("defineGame: turn.order must be 'sequential' or a function");
  }

  if (def.victory !== undefined && typeof def.victory !== 'function') {
    throw new Error('defineGame: victory must be a function when provided');
  }

  // ── phases (optional) ──────────────────────────────────────────────────────
  if (def.phases !== undefined) {
    if (
      typeof def.phases !== 'object' ||
      def.phases === null ||
      Array.isArray(def.phases)
    ) {
      throw new Error('defineGame: phases must be a non-empty object when provided');
    }

    const phaseIds = Object.keys(def.phases);
    if (phaseIds.length === 0) {
      throw new Error('defineGame: phases must be a non-empty object when provided');
    }

    const knownMoves = new Set(moveIds);
    const knownPhases = new Set(phaseIds);

    for (const phaseId of phaseIds) {
      const phase = def.phases[phaseId];
      if (typeof phase !== 'object' || phase === null) {
        throw new Error(`defineGame: phase "${phaseId}" must be an object`);
      }
      if (!Array.isArray(phase.moves)) {
        throw new Error(`defineGame: phase "${phaseId}" must declare a moves array`);
      }
      for (const moveId of phase.moves) {
        if (!knownMoves.has(moveId)) {
          throw new Error(
            `defineGame: phase "${phaseId}" references unknown move "${moveId}"`,
          );
        }
      }
      if (phase.next !== undefined && !knownPhases.has(phase.next)) {
        throw new Error(
          `defineGame: phase "${phaseId}" next references unknown phase "${phase.next}"`,
        );
      }
      Object.freeze(phase.moves);
      Object.freeze(phase);
    }

    Object.freeze(def.phases);
  }

  // ── viewFor (optional) ─────────────────────────────────────────────────────
  if (def.viewFor !== undefined && typeof def.viewFor !== 'function') {
    throw new Error('defineGame: viewFor must be a function when provided');
  }

  // Freeze the contract surface so the definition is immutable after creation.
  // (Game-specific state `G` is not frozen here — that is the reducer's domain.)
  Object.freeze(def.moves);
  Object.freeze(def.turn);
  return Object.freeze(def);
}

/**
 * The initial phase of a definition: the first key (insertion order) of
 * `def.phases`, or `null` when the game declares no phases (single implicit
 * phase, all moves allowed — PR-1 back-compat).
 */
export function initialPhase<G>(def: GameDefinition<G>): string | null {
  if (def.phases === undefined) return null;
  const ids = Object.keys(def.phases);
  // defineGame guarantees phases is non-empty when present.
  return ids[0] ?? null;
}
