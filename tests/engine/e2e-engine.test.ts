/**
 * e2e-engine.test.ts
 *
 * End-to-end proof that the @hd/game-kit/engine contract composes into a
 * working game: a toy tic-tac-toe module (tests/engine/fixtures/tic-tac-toe.ts)
 * is driven from setup to a decided result through the PUBLIC engine API only —
 * `defineGame → createMatch → validateMove / reduce (with endTurn) → victory`.
 *
 * What this proves (the engine's self-test):
 *   1. a full match plays out and the correct winner lands in ctx.gameover;
 *   2. the whole state trajectory (board + currentPlayer + phase) is correct;
 *   3. every illegal action is blocked — playing for someone else, spoofing
 *      the player, out-of-range / occupied cells, a phase-gated move, and any
 *      move after the game is over;
 *   4. DISCRIMINATING POWER: an impure move that mutates its input is detected,
 *      so a passing run is not a false green.
 *
 * It uses ONLY the engine's public exports — no src/ business code is touched.
 */

import { describe, it, expect } from 'vitest';
import {
  defineGame,
  createMatch,
  reduce,
  validateMove,
} from '../../src/engine/index.js';
import type { Action, MatchState, MoveFn } from '../../src/engine/index.js';
import { ticTacToe, type TicTacToeState } from './fixtures/tic-tac-toe.js';

// ── a full game, server-authoritatively, to a real win ──────────────────────

/**
 * Apply an action via the server-authoritative path (validateMove), asserting
 * it is accepted by the given player, and return the recomputed match state.
 */
function applyOk(
  game: ReturnType<typeof ticTacToe>,
  match: MatchState<TicTacToeState>,
  action: Action,
  playerId: number,
): MatchState<TicTacToeState> {
  const r = validateMove(game, match, action, playerId);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`unexpected rejection: ${r.reason}`);
  return r.nextState;
}

describe('engine e2e — a full tic-tac-toe game to a decided winner', () => {
  it('plays opening → play, advances turns, and player 0 wins on the top row', () => {
    const game = ticTacToe();
    let match = createMatch(game, 2);

    // initial trajectory
    expect(match.ctx.currentPlayer).toBe(0);
    expect(match.ctx.phase).toBe('opening');
    expect(match.ctx.gameover).toBe(null);
    expect(match.G.board).toEqual([null, null, null, null, null, null, null, null, null]);

    // P0 places at 0, ends turn → leaves `opening`, enters `play`, P1 to act.
    match = applyOk(game, match, { type: 'place', payload: 0, events: { endTurn: true } }, 0);
    expect(match.ctx.currentPlayer).toBe(1);
    expect(match.ctx.phase).toBe('play');
    expect(match.ctx.gameover).toBe(null);
    expect(match.G.board[0]).toBe(0);

    // P1 places at 3, ends turn → back to P0, still `play`.
    match = applyOk(game, match, { type: 'place', payload: 3, events: { endTurn: true } }, 1);
    expect(match.ctx.currentPlayer).toBe(0);
    expect(match.ctx.phase).toBe('play');

    // P0 places at 1, ends turn → P1.
    match = applyOk(game, match, { type: 'place', payload: 1, events: { endTurn: true } }, 0);
    expect(match.ctx.currentPlayer).toBe(1);

    // P1 places at 4, ends turn → P0.
    match = applyOk(game, match, { type: 'place', payload: 4, events: { endTurn: true } }, 1);
    expect(match.ctx.currentPlayer).toBe(0);
    expect(match.ctx.gameover).toBe(null);

    // P0 places at 2 → completes the top row 0-1-2 → victory = player 0.
    match = applyOk(game, match, { type: 'place', payload: 2 }, 0);
    expect(match.G.board.slice(0, 3)).toEqual([0, 0, 0]);
    expect(match.ctx.gameover).toBe(0);

    // The winning move does NOT advance the turn even if endTurn was set
    // (verified separately below); here currentPlayer stays the winner.
    expect(match.ctx.currentPlayer).toBe(0);

    // ── after gameover: every further move is rejected ──────────────────────
    const after = validateMove(game, match, { type: 'place', payload: 5 }, 0);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.reason).toMatch(/game is over/);
  });

  it('the winning move does not advance the turn even with endTurn', () => {
    const game = ticTacToe();
    let match = createMatch(game, 2);
    // Drive to a position where P0's next placement wins, all via the engine.
    match = applyOk(game, match, { type: 'place', payload: 0, events: { endTurn: true } }, 0); // P0
    match = applyOk(game, match, { type: 'place', payload: 3, events: { endTurn: true } }, 1); // P1
    match = applyOk(game, match, { type: 'place', payload: 1, events: { endTurn: true } }, 0); // P0
    match = applyOk(game, match, { type: 'place', payload: 4, events: { endTurn: true } }, 1); // P1
    // Winning move WITH endTurn — engine must ignore the turn advance on a win.
    const r = reduce(game, match, { type: 'place', payload: 2, events: { endTurn: true } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.gameover).toBe(0);
    expect(r.state.ctx.currentPlayer).toBe(0); // unchanged — winner, not P1
  });

  it('a full board with no line ends in a draw', () => {
    const game = ticTacToe();
    let match = createMatch(game, 2);
    // A known drawn fill order (X=P0, O=P1):
    //  0:X 1:X 2:O
    //  3:O 4:O 5:X
    //  6:X 7:O 8:X   → no 3-in-a-row, board full → 'draw'
    const order: ReadonlyArray<[number, number]> = [
      [0, 0], [2, 1], [1, 0], [3, 1], [5, 0], [4, 1], [6, 0], [7, 1],
    ];
    for (const [cell, player] of order) {
      match = applyOk(game, match, { type: 'place', payload: cell, events: { endTurn: true } }, player);
      expect(match.ctx.gameover).toBe(null);
    }
    // Final placement by P0 at 8 fills the board with no winner → draw.
    expect(match.ctx.currentPlayer).toBe(0);
    match = applyOk(game, match, { type: 'place', payload: 8 }, 0);
    expect(match.G.board.every((c) => c !== null)).toBe(true);
    expect(match.ctx.gameover).toBe('draw');
  });
});

// ── illegal actions are all blocked ─────────────────────────────────────────

describe('engine e2e — illegal actions are rejected', () => {
  it("rejects playing for someone else (validateMove 'not your turn')", () => {
    const game = ticTacToe();
    const match = createMatch(game, 2); // P0 to act
    // Player 1 tries to act while it is P0's turn.
    const r = validateMove(game, match, { type: 'place', payload: 0 }, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/not your turn/);
  });

  it("rejects a spoofed action.player (validateMove 'player spoof')", () => {
    const game = ticTacToe();
    const match = createMatch(game, 2); // authenticated P0 to act
    // The authenticated player is 0, but the action self-reports player 1.
    const r = validateMove(game, match, { type: 'place', payload: 0, player: 1 }, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/player spoof/);
  });

  it('rejects a phase-gated move (pass is illegal during opening)', () => {
    const game = ticTacToe();
    const match = createMatch(game, 2);
    expect(match.ctx.phase).toBe('opening');
    const r = reduce(game, match, { type: 'pass' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/move not allowed in phase opening/);
  });

  it('allows pass once in the play phase', () => {
    const game = ticTacToe();
    let match = createMatch(game, 2);
    match = applyOk(game, match, { type: 'place', payload: 0, events: { endTurn: true } }, 0);
    expect(match.ctx.phase).toBe('play');
    // P1 may now pass.
    const r = reduce(game, match, { type: 'pass', events: { endTurn: true } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.currentPlayer).toBe(0); // pass still ended the turn
  });

  it('rejects an out-of-range cell', () => {
    const game = ticTacToe();
    const match = createMatch(game, 2);
    const r = reduce(game, match, { type: 'place', payload: 99 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/out of range/);
  });

  it('rejects placing on an occupied cell', () => {
    const game = ticTacToe();
    let match = createMatch(game, 2);
    match = applyOk(game, match, { type: 'place', payload: 4, events: { endTurn: true } }, 0);
    // P1 tries to take the same cell.
    const r = reduce(game, match, { type: 'place', payload: 4 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/already occupied/);
  });

  it('rejects an unknown move type', () => {
    const game = ticTacToe();
    const match = createMatch(game, 2);
    const r = reduce(game, match, { type: 'teleport' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/unknown move/);
  });
});

// ── the move is pure: the engine never mutates the input match ──────────────

describe('engine e2e — purity of the trajectory', () => {
  it('does not mutate the previous match state when applying a move', () => {
    const game = ticTacToe();
    const match = createMatch(game, 2);
    const snapshot = structuredClone(match);
    reduce(game, match, { type: 'place', payload: 0, events: { endTurn: true } });
    expect(match).toEqual(snapshot);
  });

  it('produces a fresh board reference (no aliasing into the previous state)', () => {
    const game = ticTacToe();
    const match = createMatch(game, 2);
    const r = reduce(game, match, { type: 'place', payload: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.G.board).not.toBe(match.G.board);
  });
});

// ── DISCRIMINATING POWER: prove these tests are not a false green ────────────
//
// We define a deliberately IMPURE variant of the toy game whose `place` move
// MUTATES the input board (the cardinal sin the MoveFn purity contract forbids)
// and ALIASES it into the returned state. We then assert that our purity checks
// actually catch this — i.e. the same assertions that pass for the real fixture
// FAIL for the impure one. This guarantees the suite has teeth: a regression
// that broke purity would be detected, not silently passed.

describe('engine e2e — discriminating power (impurity is detected)', () => {
  // A purity-violating game: `badPlace` mutates the input board in place and
  // returns a state that aliases it. This is exactly what the engine contract
  // forbids; we use it ONLY to prove our purity assertions have teeth.
  const badPlace: MoveFn<TicTacToeState> = (state, ctx, payload) => {
    const cell = payload as number;
    // ⛔ mutate the input array in place (contract violation) …
    (state.board as Array<number | null>)[cell] = ctx.currentPlayer;
    // … and alias it straight into the returned state.
    return { board: state.board, placed: state.placed + 1 };
  };

  const impureGame = defineGame<TicTacToeState>({
    name: 'tic-tac-toe-impure',
    setup: () => ({ board: [null, null, null, null, null, null, null, null, null], placed: 0 }),
    moves: { place: badPlace },
    turn: { minPlayers: 2, maxPlayers: 2, order: 'sequential' },
  });

  it('the input-mutation assertion FAILS for an impure move (so it is meaningful)', () => {
    const match = createMatch(impureGame, 2);
    const snapshot = structuredClone(match);
    reduce(impureGame, match, { type: 'place', payload: 0 });
    // The impure move mutated `match.G.board`, so it no longer equals the
    // snapshot. We assert the divergence here; the SAME shape of assertion
    // (toEqual(snapshot)) PASSES for the real fixture above — proving the
    // purity test discriminates pure from impure implementations.
    expect(match).not.toEqual(snapshot);
    expect(match.G.board[0]).toBe(0); // input was mutated in place
  });

  it('the fresh-reference assertion FAILS for an impure move (aliasing detected)', () => {
    const match = createMatch(impureGame, 2);
    const r = reduce(impureGame, match, { type: 'place', payload: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The impure move aliased the input board into the result, so the
    // "fresh reference" invariant that holds for the real fixture is VIOLATED.
    expect(r.state.G.board).toBe(match.G.board);
  });
});
