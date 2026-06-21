/**
 * @hd/game-kit/engine — reduce.
 *
 * The deterministic core reducer, now a full turn state machine over the
 * engine's match state `{ G, ctx }`. `reduce(def, match, action)` is a PURE
 * function: it never mutates its inputs and, given the same `(match, action)`,
 * always produces an equal result (each move must be pure — see the `MoveFn`
 * contract in types.ts).
 *
 * PR-2 scope:
 *   - operate on {@link MatchState} (`{ G, ctx }`), not bare game state;
 *   - phase gating: a move must be allowed by the current phase;
 *   - turn advancement: when an action asks to `endTurn`, advance the current
 *     player by the turn order and (if the phase declares `next`) the phase;
 *   - victory: run `def.victory(G)` after every successful move and record the
 *     result in `ctx.gameover`; once over, all further moves are rejected.
 */
import { initialPhase } from './defineGame.js';
import { nextPlayer, TurnOrderError } from './turnOrder.js';
/**
 * Build the initial match state for a definition.
 *
 * Constructs the engine context (player 0 to act, initial phase, no winner),
 * runs `def.setup(ctx)` to produce the initial game state, and returns
 * `{ G, ctx }`.
 *
 * @param def        a definition produced by `defineGame`.
 * @param numPlayers number of players for this match. Defaults to
 *                   `def.turn.minPlayers`. Must satisfy the definition's
 *                   `minPlayers ≤ numPlayers ≤ maxPlayers`.
 * @throws Error if `numPlayers` is out of the definition's allowed range.
 */
export function createMatch(def, numPlayers = def.turn.minPlayers) {
    if (!Number.isInteger(numPlayers)) {
        throw new Error('createMatch: numPlayers must be an integer');
    }
    if (numPlayers < def.turn.minPlayers || numPlayers > def.turn.maxPlayers) {
        throw new Error(`createMatch: numPlayers ${numPlayers} out of range ` +
            `[${def.turn.minPlayers}, ${def.turn.maxPlayers}]`);
    }
    const ctx = {
        numPlayers,
        currentPlayer: 0,
        phase: initialPhase(def),
        gameover: null,
    };
    const G = def.setup(ctx);
    return { G, ctx, log: [] };
}
/**
 * Whether `moveId` is permitted in the current phase.
 *
 * With no phases declared (`ctx.phase === null`), every move is allowed
 * (PR-1 back-compat). Otherwise only the current phase's declared moves are.
 */
function isMoveAllowedInPhase(def, phase, moveId) {
    if (phase === null || def.phases === undefined)
        return true;
    const phaseConfig = def.phases[phase];
    if (phaseConfig === undefined)
        return false;
    return phaseConfig.moves.includes(moveId);
}
/**
 * Apply a single action to a match state via the matching move, then apply
 * engine transitions (victory, optional turn/phase advancement).
 *
 * Behaviour (first match wins; all rejections leave inputs untouched):
 *   - malformed action (no string `type`) → `{ ok: false }`.
 *   - game already over (`ctx.gameover !== null`) → `{ ok: false }`.
 *   - unknown move id → `{ ok: false }`.
 *   - move not allowed in current phase → `{ ok: false }`.
 *   - move throws → `{ ok: false }` (illegal move signalled by the move).
 *   - invalid turn-order result on `endTurn` → `{ ok: false }`.
 *   - otherwise → `{ ok: true, state: nextMatchState }`.
 *
 * The reducer never mutates `match`; immutability of `G` depends on the move
 * honouring the `MoveFn` purity contract.
 *
 * @param def    a definition produced by `defineGame`.
 * @param match  the current match state `{ G, ctx }`.
 * @param action the action to apply.
 */
export function reduce(def, match, action) {
    if (typeof action !== 'object' || action === null || typeof action.type !== 'string') {
        return { ok: false, error: 'reduce: action must have a string "type"' };
    }
    const { G, ctx } = match;
    if (ctx.gameover !== null) {
        return { ok: false, error: 'reduce: game is over' };
    }
    const move = def.moves[action.type];
    if (typeof move !== 'function') {
        return { ok: false, error: `reduce: unknown move "${action.type}"` };
    }
    if (!isMoveAllowedInPhase(def, ctx.phase, action.type)) {
        return {
            ok: false,
            error: `reduce: move not allowed in phase ${String(ctx.phase)}`,
        };
    }
    // ── run the (pure) move ────────────────────────────────────────────────────
    let nextG;
    try {
        nextG = move(G, ctx, action.payload);
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `reduce: move "${action.type}" rejected: ${reason}` };
    }
    // ── victory check (after every successful move) ────────────────────────────
    const gameover = def.victory !== undefined ? (def.victory(nextG) ?? null) : null;
    // A finished game never advances turn/phase, regardless of endTurn.
    if (gameover !== null) {
        const nextCtx = { ...ctx, gameover };
        const record = {
            action: Object.freeze({ ...action }),
            playerBefore: ctx.currentPlayer,
            phaseBefore: ctx.phase,
            playerAfter: nextCtx.currentPlayer,
            phaseAfter: nextCtx.phase,
        };
        return {
            ok: true,
            state: { G: nextG, ctx: nextCtx, log: [...match.log, record] },
        };
    }
    // ── turn / phase advancement (only when the action asks to end the turn) ───
    if (action.events?.endTurn === true) {
        let advancedPlayer;
        try {
            advancedPlayer = nextPlayer(ctx, def.turn.order);
        }
        catch (err) {
            if (err instanceof TurnOrderError) {
                return { ok: false, error: `reduce: ${err.message}` };
            }
            throw err;
        }
        const nextPhase = phaseAfterTurn(def, ctx.phase);
        const nextCtx = { ...ctx, currentPlayer: advancedPlayer, phase: nextPhase };
        const record = {
            action: Object.freeze({ ...action }),
            playerBefore: ctx.currentPlayer,
            phaseBefore: ctx.phase,
            playerAfter: nextCtx.currentPlayer,
            phaseAfter: nextCtx.phase,
        };
        return {
            ok: true,
            state: {
                G: nextG,
                ctx: nextCtx,
                log: [...match.log, record],
            },
        };
    }
    // ── no transition requested: same player, same phase ───────────────────────
    const nextCtx = { ...ctx };
    const record = {
        action: Object.freeze({ ...action }),
        playerBefore: ctx.currentPlayer,
        phaseBefore: ctx.phase,
        playerAfter: nextCtx.currentPlayer,
        phaseAfter: nextCtx.phase,
    };
    return { ok: true, state: { G: nextG, ctx: nextCtx, log: [...match.log, record] } };
}
/**
 * The phase to be in after a turn ends. If the current phase declares `next`,
 * transition to it; otherwise stay in the current phase. `null` (no phases)
 * stays `null`.
 */
function phaseAfterTurn(def, phase) {
    if (phase === null || def.phases === undefined)
        return phase;
    const phaseConfig = def.phases[phase];
    if (phaseConfig === undefined)
        return phase;
    return phaseConfig.next ?? phase;
}
//# sourceMappingURL=reduce.js.map