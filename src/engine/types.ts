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
 * NOTE: PR-1 deliberately does NOT implement phases / turn advancement; those
 * fields are reserved for PR-2. Only the minimal "given state + move → new
 * state" closed loop is provided here.
 */

/**
 * Engine-supplied context handed to `setup` and every `MoveFn`.
 *
 * PR-1 keeps this minimal and forward-compatible: `numPlayers` is known at
 * setup time. Turn/phase context is reserved for PR-2.
 */
export interface GameContext {
  /** Number of players the match was set up for. */
  readonly numPlayers: number;
}

/**
 * A single move: a PURE function from (state, ctx, payload) to a NEW state.
 *
 * ⛔ MUST NOT mutate `state`. MUST return a new value. The reducer treats any
 * thrown error as a rejected move (returns `{ ok: false }`), so a move may
 * `throw` to signal an illegal action.
 *
 * @typeParam G - the game-specific state shape.
 */
export type MoveFn<G> = (state: G, ctx: GameContext, payload?: unknown) => G;

/**
 * Turn configuration for a game definition.
 *
 * PR-1 only uses `minPlayers` / `maxPlayers` for contract validation. The
 * optional `order` field is reserved for PR-2 turn-order logic and is carried
 * through unvalidated for now.
 */
export interface TurnConfig {
  /** Minimum number of players required (must be ≥ 1 and ≤ maxPlayers). */
  readonly minPlayers: number;
  /** Maximum number of players allowed (must be ≥ minPlayers). */
  readonly maxPlayers: number;
  /** Reserved for PR-2 turn-order strategy. Unused in PR-1. */
  readonly order?: unknown;
}

/**
 * A game definition: the plug-in contract a game module implements.
 *
 * Shape intentionally aligned with boardgame.io (企劃 §5) so the engine's
 * internals can later borrow from it; PR-1 is fully self-built.
 *
 * @typeParam G - the game-specific state shape.
 */
export interface GameDefinition<G> {
  /** Non-empty unique name of the game. */
  readonly name: string;
  /** Builds the initial state for a match given the engine context. */
  setup(ctx: GameContext): G;
  /** Map of move id → pure move function. Must be a non-empty object. */
  readonly moves: Readonly<Record<string, MoveFn<G>>>;
  /** Turn / player-count configuration. */
  readonly turn: TurnConfig;
  /**
   * Optional victory check. Returns the winning player (or any truthy winner
   * marker), or `null` when there is no winner yet.
   */
  victory?(state: G): unknown | null;
}

/**
 * An action dispatched to the reducer.
 *
 * `type` selects the move by id. `player` and `payload` are optional and
 * passed through to the move (and, in later PRs, used for authority checks).
 */
export interface Action {
  /** Move id; must match a key in `GameDefinition.moves`. */
  readonly type: string;
  /** Optional acting player identifier. Reserved for PR-2/PR-3 authority. */
  readonly player?: unknown;
  /** Optional move payload, passed verbatim to the `MoveFn`. */
  readonly payload?: unknown;
}

/**
 * Result of `reduce`: a discriminated union mirroring the kit's existing
 * `RoomResult` style (`{ ok: true, ... }` / `{ ok: false, error }`).
 *
 * @typeParam G - the game-specific state shape.
 */
export type ReduceResult<G> =
  | { readonly ok: true; readonly state: G }
  | { readonly ok: false; readonly error: string };
