/**
 * @hd/game-kit/engine — core engine types.
 *
 * Deterministic, server-authoritative game engine in the boardgame.io shape
 * (企劃 §5): a game is a pure-function module of `state + moves`. This file
 * defines the contract types only — no runtime logic lives here.
 *
 * Engine purity contract:
 *   - A `MoveFn` MUST be pure: it returns a NEW state and MUST NOT mutate its
 *     inputs. The reducer relies on this for determinism.
 *
 * PR-2 layers a full turn state machine on top of the PR-1 reducer. The game
 * state `G` stays a pure domain value; turn / phase / victory are engine
 * METADATA kept in a separate `ctx`, aligned with boardgame.io's `{ G, ctx }`
 * match-state shape. The reducer now operates on `MatchState<G> = { G, ctx }`.
 */
export {};
//# sourceMappingURL=types.js.map