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
/**
 * Engine-supplied context handed to `setup` and every `MoveFn`, and also the
 * runtime metadata carried alongside the game state in a {@link MatchState}.
 *
 * `numPlayers` is fixed at setup time. `currentPlayer`, `phase` and `gameover`
 * are engine-managed turn/phase/victory metadata, kept SEPARATE from the game
 * state `G`.
 */
export interface GameContext {
    /** Number of players the match was set up for (≥ 1). */
    readonly numPlayers: number;
    /** Index of the player whose turn it is, 0-based in `[0, numPlayers)`. */
    readonly currentPlayer: number;
    /**
     * Current phase id, or `null` when the game declares no phases (PR-1
     * back-compat: every move is allowed and there is a single implicit phase).
     */
    readonly phase: string | null;
    /**
     * Victory result once the game is over, otherwise `null`. While non-null the
     * reducer rejects all further moves. The value is whatever `def.victory`
     * returned (e.g. a winning player id or marker).
     */
    readonly gameover: unknown | null;
}
/**
 * A single move: a PURE function from (state, ctx, payload) to a NEW state.
 *
 * ⛔ MUST NOT mutate `state`. MUST return a new value. The reducer treats any
 * thrown error as a rejected move (returns `{ ok: false }`), so a move may
 * `throw` to signal an illegal action.
 *
 * The move receives the engine `ctx` (current player / phase) read-only; it
 * MUST NOT try to advance the turn itself. Turn advancement is requested via
 * the action's `events.endTurn` flag and applied by the engine (see
 * {@link Action}).
 *
 * @typeParam G - the game-specific state shape.
 */
export type MoveFn<G> = (state: G, ctx: GameContext, payload?: unknown) => G;
/**
 * Turn-order strategy.
 *
 *   - `'sequential'`: advance to `(currentPlayer + 1) mod numPlayers` (wraps
 *     back to player 0).
 *   - a pure function `(ctx) => nextPlayer`: returns the next player index given
 *     the post-move context. MUST be pure and return an integer in
 *     `[0, numPlayers)`; an out-of-range / non-integer result is rejected by the
 *     reducer.
 */
export type TurnOrder = 'sequential' | ((ctx: GameContext) => number);
/**
 * Turn configuration for a game definition.
 *
 * `minPlayers` / `maxPlayers` are used for contract validation. `order`
 * selects the turn-order strategy (defaults to `'sequential'` when omitted).
 */
export interface TurnConfig {
    /** Minimum number of players required (must be ≥ 1 and ≤ maxPlayers). */
    readonly minPlayers: number;
    /** Maximum number of players allowed (must be ≥ minPlayers). */
    readonly maxPlayers: number;
    /** Turn-order strategy. Defaults to `'sequential'` when omitted. */
    readonly order?: TurnOrder;
}
/**
 * A phase declaration: which moves are allowed while in this phase, and the
 * optional phase to transition to.
 *
 * `next`, when present, is recorded on the context after a move that ends the
 * turn (i.e. phase transitions happen on turn boundaries, mirroring
 * boardgame.io's phase/turn relationship). It MUST reference an existing phase.
 */
export interface PhaseConfig {
    /** Move ids permitted while in this phase. Each MUST exist in `def.moves`. */
    readonly moves: readonly string[];
    /** Optional next phase id to move to on turn end. MUST be a declared phase. */
    readonly next?: string;
}
/**
 * A game definition: the plug-in contract a game module implements.
 *
 * Shape intentionally aligned with boardgame.io (企劃 §5) so the engine's
 * internals can later borrow from it.
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
     * Optional phases. When present, the reducer gates moves by phase: only the
     * moves a phase declares are allowed while in it. When absent, all moves are
     * allowed in the single implicit phase (PR-1 back-compat).
     *
     * The first key (insertion order) is the initial phase.
     */
    readonly phases?: Readonly<Record<string, PhaseConfig>>;
    /**
     * Optional victory check. Returns the winning player (or any truthy winner
     * marker), or `null` when there is no winner yet. Run after every successful
     * move; a non-null result is written to `ctx.gameover`.
     */
    victory?(state: G): unknown | null;
    /**
     * Optional per-player view filter for hidden-information games.
     *
     * When present, the engine knows that different players see different
     * projections of `G` (e.g. a player's own hand but not their opponents').
     * The server MUST call this function per-connection and MUST NOT broadcast
     * the full `MatchState<G>` when this hook is defined.
     *
     * Contract:
     *   - MUST be a pure function — MUST NOT mutate `match`.
     *   - MUST return a NEW object (not a reference into `match.G`) so the
     *     caller cannot accidentally expose the full state via shared references.
     *   - Return type is `unknown` so each game can define its own view shape;
     *     use {@link MaskedState} to carry the view alongside `ctx`.
     *
     * @param match    - the full, authoritative match state (server-side only).
     * @param playerId - 0-based index of the player whose view is requested.
     * @returns        a masked projection of `G` for `playerId`.
     *
     * @security Callers (server WS layer) are responsible for ensuring each
     *           connection only receives its own `filterView` result.
     *           This hook is the pure-computation layer; broadcast restriction
     *           is enforced by the server layer (PR-2 implementation).
     */
    viewFor?(match: MatchState<G>, playerId: number): unknown;
}
/**
 * The engine's match state: the pure game state `G` plus engine metadata
 * `ctx`. Aligned with boardgame.io's `{ G, ctx }`. This is what the reducer
 * consumes and produces.
 *
 * @typeParam G - the game-specific state shape.
 */
export interface MatchState<G> {
    /** The pure, game-specific domain state. */
    readonly G: G;
    /** Engine-managed turn / phase / victory metadata. */
    readonly ctx: GameContext;
}
/**
 * The per-player masked match state returned by `filterView` (PR-2).
 *
 * Carries the engine `ctx` (turn / phase / gameover — the same for all
 * players) alongside the player-specific `view` (a masked projection of `G`
 * that hides information the player is not entitled to see).
 *
 * Deliberately does NOT expose the full `G`; the type parameter `V` lets each
 * game define a narrower view shape (e.g. `{ ownHand: Card[]; opponentCount:
 * number }` instead of the full `{ hands: Card[][] }`).
 *
 * @typeParam V - the game-specific view shape for one player.
 */
export interface MaskedState<V> {
    /** The masked, player-specific view of the game state. */
    readonly view: V;
    /** Engine-managed turn / phase / victory metadata (same for all players). */
    readonly ctx: GameContext;
}
/**
 * Built-in engine events a caller may request alongside a move.
 *
 * Keeping turn advancement out of `MoveFn` preserves move purity: a move only
 * computes the next `G`; the engine applies turn/phase transitions when the
 * action asks for them.
 */
export interface ActionEvents {
    /** When true, the move ends the current turn (advance player / phase). */
    readonly endTurn?: boolean;
}
/**
 * An action dispatched to the reducer.
 *
 * `type` selects the move by id. `player` is the acting player (reserved for
 * authority checks in PR-3; the reducer carries it through). `events` requests
 * engine-managed transitions such as ending the turn.
 */
export interface Action {
    /** Move id; must match a key in `GameDefinition.moves`. */
    readonly type: string;
    /** Optional acting player identifier. Reserved for PR-3 authority. */
    readonly player?: unknown;
    /** Optional move payload, passed verbatim to the `MoveFn`. */
    readonly payload?: unknown;
    /** Optional engine events to apply after the move (e.g. `endTurn`). */
    readonly events?: ActionEvents;
}
/**
 * Result of `reduce`: a discriminated union mirroring the kit's existing
 * `RoomResult` style (`{ ok: true, ... }` / `{ ok: false, error }`).
 *
 * On success it returns the next {@link MatchState} (game state + updated
 * engine context).
 *
 * @typeParam G - the game-specific state shape.
 */
export type ReduceResult<G> = {
    readonly ok: true;
    readonly state: MatchState<G>;
} | {
    readonly ok: false;
    readonly error: string;
};
//# sourceMappingURL=types.d.ts.map