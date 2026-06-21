/**
 * tests/engine/fixtures/tic-tac-toe.ts
 *
 * A minimal TOY game built on the @hd/game-kit/engine contract, used by
 * e2e-engine.test.ts to prove "a game = a pure-function module" runs end to end
 * on the engine. ⛔ This is a TEST FIXTURE, not a live game — it is never
 * shipped, imported by src/, or wired to any server.
 *
 * It exercises the full engine surface:
 *   - defineGame  — contract + freeze,
 *   - setup       — initial board via ctx,
 *   - moves       — a pure `place` (and a `pass` that is phase-gated),
 *   - turn        — sequential 2-player order, advanced via events.endTurn,
 *   - phases      — `opening` → `play`, to demonstrate phase gating
 *                   (`pass` is illegal during `opening`),
 *   - victory     — 3-in-a-row → winning player index; full board → 'draw'.
 *
 * Board cells hold the acting player's index (0 | 1) or null when empty.
 */

import { defineGame } from '../../../src/engine/index.js';
import type { GameContext, GameDefinition, MoveFn } from '../../../src/engine/index.js';

/** Pure domain state for the toy game (the engine's `G`). */
export interface TicTacToeState {
  /** 9 cells, row-major. Each holds the player index that owns it, or null. */
  readonly board: ReadonlyArray<number | null>;
  /** Count of pieces placed so far (used only for readability in tests). */
  readonly placed: number;
}

/** The 8 winning lines (rows, columns, diagonals) as board-index triples. */
const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

/**
 * `place` — put the current player's piece on cell `payload`.
 *
 * PURE: returns a new state, never mutates `state` or `state.board`.
 * Signals an illegal action by throwing (the engine turns a throw into a
 * rejected move): out-of-range index, or a cell that is already occupied.
 *
 * The acting player comes from the engine `ctx.currentPlayer`, NOT from the
 * payload — the move never decides whose turn it is.
 */
const place: MoveFn<TicTacToeState> = (state, ctx, payload) => {
  if (typeof payload !== 'number' || !Number.isInteger(payload)) {
    throw new Error('place: payload must be an integer cell index');
  }
  if (payload < 0 || payload >= 9) {
    throw new Error(`place: cell ${payload} out of range [0, 9)`);
  }
  if (state.board[payload] !== null && state.board[payload] !== undefined) {
    throw new Error(`place: cell ${payload} already occupied`);
  }
  const board = state.board.slice();
  board[payload] = ctx.currentPlayer;
  return { board, placed: state.placed + 1 };
};

/**
 * `pass` — give up the current turn without placing.
 *
 * Only legal in the `play` phase (declared in `phases` below); attempting it in
 * `opening` is rejected by the engine's phase gating. Used to prove gating in
 * the e2e test. Pure: returns the state unchanged (a fresh shallow copy).
 */
const pass: MoveFn<TicTacToeState> = (state) => ({ board: state.board.slice(), placed: state.placed });

/**
 * Victory check: a player index when some line is fully theirs, the string
 * `'draw'` when the board is full with no winner, otherwise `null`.
 */
function victory(state: TicTacToeState): number | 'draw' | null {
  for (const [a, b, c] of LINES) {
    const v = state.board[a];
    if (v !== null && v !== undefined && v === state.board[b] && v === state.board[c]) {
      return v;
    }
  }
  if (state.board.every((cell) => cell !== null && cell !== undefined)) {
    return 'draw';
  }
  return null;
}

/**
 * Build the toy tic-tac-toe game definition.
 *
 * Phases: starts in `opening` (only `place` allowed) and transitions to `play`
 * on the first turn end (so `pass` becomes legal from the 2nd player onward).
 * This is purely to demonstrate phase gating on the engine; the win/lose logic
 * is independent of phase.
 */
export function ticTacToe(): GameDefinition<TicTacToeState> {
  return defineGame<TicTacToeState>({
    name: 'tic-tac-toe',
    setup: (_ctx: GameContext): TicTacToeState => ({
      board: [null, null, null, null, null, null, null, null, null],
      placed: 0,
    }),
    moves: { place, pass },
    turn: { minPlayers: 2, maxPlayers: 2, order: 'sequential' },
    phases: {
      // First turn: only placing is allowed (demonstrates gating: `pass` is
      // illegal here). On turn end → `play`.
      opening: { moves: ['place'], next: 'play' },
      // Thereafter: place or pass.
      play: { moves: ['place', 'pass'] },
    },
    victory,

    /**
     * enumerate — payload candidates for the bot.
     *
     * 'place': all unoccupied cell indices (null cells) in row-major order.
     *          An empty array means no legal placements remain (board full).
     * 'pass':  [undefined] — pass takes no payload; the single undefined
     *          candidate lets the bot walk the enumerate path without guessing.
     * other:   [] — unknown move ids yield no candidates (bot skips them).
     *
     * Design note: returning only null cells means the bot never wastes shuffle
     * attempts on occupied cells. However, even if enumerate returned all 9
     * indices (including occupied ones), the bot's shuffle-try loop would
     * self-heal: validateMove rejects occupied-cell placements, the bot
     * automatically tries the next shuffled candidate, and eventually lands on
     * a legal cell. This robustness is intentional and documented in the PR.
     */
    enumerate(match, moveId, _playerId) {
      if (moveId === 'place') {
        // Return the indices of all null (unoccupied) cells.
        return (match.G as TicTacToeState).board
          .map((cell, i) => (cell === null ? i : -1))
          .filter((i) => i !== -1);
      }
      if (moveId === 'pass') {
        // pass requires no payload; a single undefined lets the bot walk it.
        return [undefined];
      }
      return [];
    },
  });
}
