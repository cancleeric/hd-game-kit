/**
 * @hd/game-kit/engine — replayMatch: time-travel replay from a move-log.
 *
 * `replayMatch` is a PURE function that reconstructs every intermediate
 * `MatchState<G>` from the ordered `MoveRecord[]` log produced by a live match.
 * It is useful for:
 *
 *   - time-travel debugging (inspect the state at any point in history),
 *   - spectator replay (feed snapshots to a UI renderer),
 *   - server-side audit (verify a recorded log is internally consistent).
 *
 * **Known limitation — deterministic setup required:**
 * `replayMatch` calls `createMatch(def, numPlayers)` to obtain the initial
 * state. This means `def.setup` MUST be deterministic: the same `numPlayers`
 * MUST always produce the same initial `G`. Games whose `setup` uses a
 * non-deterministic source (e.g. a seeded RNG that is NOT replayed) will
 * produce a diverging initial state and therefore an incorrect replay.
 * Capturing the initial state as an explicit snapshot, and threading it into
 * replay, is a known enhancement left for a future version. For now, treat
 * `replayMatch` as suitable for deterministic-setup games only.
 *
 * Browser-safe: no node:crypto / no I/O.
 */
import { createMatch, reduce } from './reduce.js';
/**
 * Replay a match from its move-log, returning one `MatchState<G>` snapshot per
 * step (including the initial state).
 *
 * The returned array has length `log.length + 1`:
 *   - `snapshots[0]`   — initial state (before any move is applied).
 *   - `snapshots[k]`   — state AFTER the k-th log entry has been applied
 *                         (1-indexed: `snapshots[1]` is after `log[0]`).
 *   - `snapshots[N]`   — final state (N = log.length).
 *
 * Each snapshot carries its own `.log` (the subset of moves applied so far),
 * satisfying the time-travel invariant: `snapshots[k].log.length === k`.
 *
 * @param def        - the game definition (must be deterministic in `setup`).
 * @param log        - the ordered `MoveRecord[]` produced by the original match.
 * @param numPlayers - number of players. **MUST match the original match's
 *                     `numPlayers`**; the log does not store this value.
 *                     Defaults to `def.turn.minPlayers`.
 *
 * @returns ordered array of match-state snapshots, length = `log.length + 1`.
 *
 * @throws Error if any log entry cannot be replayed (corrupted log), with a
 *         message indicating which step failed.
 *
 * @remarks
 * **Replay assumes `def.setup` is deterministic**: the same `numPlayers` input
 * must always produce the same initial `G`. Games that use a non-deterministic
 * setup (e.g. a non-replayed seeded RNG) must capture the initial state
 * explicitly — this is a known limitation and a future enhancement.
 */
export function replayMatch(def, log, numPlayers = def.turn.minPlayers) {
    const initial = createMatch(def, numPlayers);
    const snapshots = [initial];
    let current = initial;
    for (let i = 0; i < log.length; i++) {
        const record = log[i];
        const result = reduce(def, current, record.action);
        if (!result.ok) {
            throw new Error(`replayMatch: log corrupted at step ${i} (action type "${record.action.type}"): ${result.error}`);
        }
        current = result.state;
        snapshots.push(current);
    }
    return snapshots;
}
//# sourceMappingURL=replay.js.map