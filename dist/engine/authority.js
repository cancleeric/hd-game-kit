/**
 * @hd/game-kit/engine — authority.
 *
 * Server-authoritative move validation (企劃 §5「move 在 server 重算驗證，防作弊」).
 * This is the防作弊 seed of the C architecture: it moves rule enforcement off the
 * client and onto the server.
 *
 * `validateMove` is a PURE function. It performs two authority checks and then
 * RECOMPUTES the next state on the server, trusting ONLY the server-held
 * `prevMatch` — never any client-supplied state.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * @security — trust model (MUST hold when this is wired into a real server)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. `playerId` MUST come from the server-side AUTHENTICATED socket binding
 *      (the same player identity established at room join — see RoomManager's
 *      `@security` note that playerId/hostPlayerId must be a server binding,
 *      never taken from a C2S message payload). In this PR `playerId` is a
 *      parameter so the pure logic can be unit-tested with attack vectors;
 *      ⛔ at wire-up time it MUST NOT be read from the client's self-reported
 *      message. A client may spoof `action.player`; it MUST NOT be able to
 *      spoof the authenticated `playerId`.
 *
 *   2. The next state is recomputed SOLELY from the server-held `prevMatch`
 *      via the same `reduce`. ⛔ This function never accepts, reads, or trusts
 *      any client-supplied `nextState` / `gameState`. The client's only
 *      influence is the requested action (move id / payload / endTurn); the
 *      server decides the resulting state.
 *
 *   3. NO fall-through: any failed check returns a rejection immediately. There
 *      is no code path where a move is applied after a check has failed.
 */
import { reduce } from './reduce.js';
/**
 * Server-authoritative validation of a single move.
 *
 * Pipeline (first failed check returns immediately — ⛔ no fall-through):
 *
 *   1. IDENTITY — the acting player MUST be the player whose turn it is.
 *      `playerId` is the server-authenticated identity (see `@security` above).
 *      Rejected with `'not your turn'` when it does not equal
 *      `prevMatch.ctx.currentPlayer`. This blocks "playing for someone else".
 *
 *   2. ANTI-SPOOF — if the action carries a `player` field, it MUST equal the
 *      authenticated `playerId`. A client that self-reports a different player
 *      in the action is rejected with `'player spoof'`. (The authenticated
 *      `playerId` is the source of truth; `action.player` is untrusted input.)
 *
 *   3. RECOMPUTE — the next state is computed by `reduce(def, prevMatch, action)`
 *      using ONLY the server-held `prevMatch`. `reduce` itself enforces phase
 *      legality, unknown-move / game-over / turn-order rules; any rejection is
 *      surfaced as `{ ok: false, reason }`. ⛔ No client-supplied state is read.
 *
 * @param def       a definition produced by `defineGame`.
 * @param prevMatch the SERVER-held current match state `{ G, ctx }`. This is the
 *                  sole source of truth for the recomputation.
 * @param action    the requested action (move id / payload / endTurn). Its
 *                  `player` field, if present, is treated as untrusted and only
 *                  checked against `playerId` for spoof detection.
 * @param playerId  the SERVER-AUTHENTICATED acting player index (0-based, the
 *                  same space as `ctx.currentPlayer`). ⛔ MUST come from the
 *                  authenticated socket binding, never from client input.
 * @returns `{ ok: true, nextState }` with the server-recomputed match state, or
 *          `{ ok: false, reason }`.
 */
export function validateMove(def, prevMatch, action, playerId) {
    // ── 1. identity: acting player must be the current player ──────────────────
    if (playerId !== prevMatch.ctx.currentPlayer) {
        return { ok: false, reason: 'not your turn' };
    }
    // ── 2. anti-spoof: action.player (untrusted) must match authenticated id ───
    // `action.player` is optional and typed `unknown` (client-supplied). When the
    // client includes it, it MUST agree with the authenticated playerId; a
    // mismatch is a spoof attempt.
    if (action.player !== undefined && action.player !== playerId) {
        return { ok: false, reason: 'player spoof' };
    }
    // ── 3. server recompute: phase legality + state transition via reduce ──────
    // Uses ONLY the server-held prevMatch. ⛔ No client-supplied state is trusted.
    const result = reduce(def, prevMatch, action);
    if (!result.ok) {
        return { ok: false, reason: result.error };
    }
    return { ok: true, nextState: result.state };
}
//# sourceMappingURL=authority.js.map