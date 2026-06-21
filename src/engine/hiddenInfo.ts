/**
 * @hd/game-kit/engine — hiddenInfo.
 *
 * Per-player hidden-information view filtering (企劃 §5「手牌不外洩，社推遊戲必須」).
 *
 * `filterView` is the pure-computation layer: it computes the masked state that
 * a SPECIFIC player is allowed to see. The caller (server WS layer) is wholly
 * responsible for delivering each result only to the correct connection.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * @security — broadcast restriction contract
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. The CALLER (server WS layer) MUST ensure that each WebSocket connection
 *      receives ONLY the `filterView` result computed for THAT player's
 *      `playerId`. Broadcasting a single `filterView` call's result to multiple
 *      connections is a security violation.
 *
 *   2. ⛔ When `def.viewFor` is defined, the server MUST NOT broadcast the
 *      full `MatchState<G>` to any client. Even a "partial" broadcast of the
 *      raw `G` to any connection is a violation.
 *
 *   3. This module is the PURE COMPUTATION LAYER only. It does not hold any
 *      WebSocket references, sessions, or network state. The broadcast
 *      restriction is enforced entirely by the server layer.
 *
 *   4. `viewFor` (and therefore `filterView`) MUST NOT mutate the `match`
 *      argument. The returned `view` is a NEW object produced by `viewFor`;
 *      it must not contain any live reference into `match.G` that would allow
 *      the caller to reach the full game state through the view.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { GameDefinition, MaskedState, MatchState } from './types.js';

/**
 * Returns the per-player masked state for `playerId`.
 *
 * Behavior:
 *   - If `def.viewFor` is defined: calls it with `(match, playerId)`, wraps
 *     the returned view in `{ view, ctx: match.ctx }`, and returns a
 *     `MaskedState<V>`. The `ctx` is identical for all players (it is not
 *     sensitive: it holds turn number, currentPlayer, phase, gameover).
 *   - If `def.viewFor` is NOT defined (no hidden information): returns the
 *     original `match` unchanged (backward-compatible — games with no hidden
 *     information may broadcast the full `MatchState<G>` safely).
 *
 * Purity contract:
 *   - MUST NOT mutate `match` or `match.G`.
 *   - The returned `view` (when `viewFor` is present) is a new object
 *     produced by `viewFor` — it must not be a reference into `match.G`.
 *
 * @param def      - a definition produced by `defineGame`.
 * @param match    - the full, authoritative match state (server-side only).
 * @param playerId - 0-based index of the player whose view is requested.
 * @returns `MaskedState<V>` when hidden info is present; `MatchState<G>`
 *          when `viewFor` is absent (backward-compatible passthrough).
 *
 * @security See module-level `@security` block above. The caller is
 *           responsible for per-connection delivery.
 */
export function filterView<G, V = unknown>(
  def: GameDefinition<G>,
  match: MatchState<G>,
  playerId: number,
): MaskedState<V> | MatchState<G> {
  if (def.viewFor !== undefined) {
    // Call the game's view filter. viewFor MUST return a new object — this is
    // the game author's responsibility (enforced by the @security contract
    // above and verified by the attack-vector tests in hidden-info.test.ts).
    const view = def.viewFor(match, playerId) as V;
    // Return a new MaskedState object. match.ctx is already readonly on the
    // MatchState interface; spreading it here creates a new object reference
    // so the caller cannot mutate the engine's ctx through our return value.
    return {
      view,
      ctx: match.ctx,
    } satisfies MaskedState<V>;
  }

  // No hidden-info hook: return the original match (no copy needed — the
  // engine already guarantees MatchState<G> is readonly).
  return match;
}

/**
 * Returns `true` if the game definition declares hidden information (i.e.
 * `def.viewFor` is present), `false` otherwise.
 *
 * Use this as a fast branch in the server WS layer to decide whether to call
 * `filterView` per connection or to broadcast the full `MatchState<G>`:
 *
 * ```ts
 * if (hasHiddenInfo(def)) {
 *   for (const conn of connections) {
 *     conn.send(filterView(def, match, conn.playerId));
 *   }
 * } else {
 *   broadcast(match); // safe: no hidden info
 * }
 * ```
 *
 * @param def - a definition produced by `defineGame`.
 * @returns `true` when `def.viewFor` is a function, `false` otherwise.
 */
export function hasHiddenInfo<G>(def: GameDefinition<G>): boolean {
  return typeof def.viewFor === 'function';
}
