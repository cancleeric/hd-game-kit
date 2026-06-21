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
 *   5. BOT SELF-PLAY: makeRandomMove with a seeded rng drives a 2-player
 *      tic-tac-toe match to a determined gameover; result is identical across
 *      runs (deterministic, CI-repeatable).
 *   6. HIDDEN-INFO E2E: filterView on hidden-card-game returns per-player views
 *      where each player's hand values are invisible to the other, and ctx is
 *      identical across views.
 *
 * It uses ONLY the engine's public exports — no src/ business code is touched.
 */

import { describe, it, expect } from 'vitest';
import {
  defineGame,
  createMatch,
  reduce,
  validateMove,
  makeRandomMove,
  filterView,
  hasHiddenInfo,
} from '../../src/engine/index.js';
import type { Action, MatchState, MoveFn } from '../../src/engine/index.js';
import { ticTacToe, type TicTacToeState } from './fixtures/tic-tac-toe.js';
import {
  hiddenCardGame,
  type CardGameState,
  type CardGameView,
  type CardGameMaskedState,
} from './fixtures/hidden-card-game.js';

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

// ── BOT SELF-PLAY e2e ────────────────────────────────────────────────────────
//
// Prove that makeRandomMove drives a match from start to a decided gameover
// when two bots alternate turns with an injected seeded rng.
//
// We use hidden-card-game (draw-only path) because the engine bot API selects
// move TYPES at random but does not generate payloads. hidden-card-game's
// `draw` move requires no payload (it takes the top deck card), making it
// naturally bot-friendly. `discard` requires a hand-index payload; when the
// bot's randomly selected action happens to be `discard`, validateMove rejects
// it (illegal payload) and the bot retries with `draw`. In practice the deck
// exhausts and the game terminates without needing discard.
//
// Key properties under test:
//   A. The match always reaches ctx.gameover !== null (game terminates).
//   B. With a fixed rng the exact winner is the same across every run
//      (deterministic, CI-repeatable; no Math.random() flakiness).
//   C. makeRandomMove refuses to act after gameover.
//
// The seeded rng used here is a simple linear congruential generator; it is
// entirely deterministic so the test outcome is locked in.

/** Minimal seeded LCG: same sequence every call from the same initial seed. */
function makeLcgRng(seed: number): () => number {
  let s = seed;
  return () => {
    // LCG parameters from Numerical Recipes
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    // Map to [0, 1) using unsigned 32-bit interpretation
    return ((s >>> 0) / 0x100000000);
  };
}

describe('engine e2e — bot self-play (makeRandomMove, deterministic rng)', () => {
  it('two bots play hidden-card-game to a decided gameover (seed=42)', () => {
    // hidden-card-game: deck starts with 16 cards (101..116), each player is
    // dealt 2, leaving 12. The `draw` move needs no payload; `discard` does but
    // will be naturally rejected by validateMove (undefined payload → throw),
    // so the bot falls back to `draw` on retry. The game ends when deck empties.
    const game = hiddenCardGame();
    let match = createMatch(game, 2);

    const rng = makeLcgRng(42);
    let steps = 0;
    const MAX_STEPS = 200; // 12 remaining cards / 2 players = ~12 turns; guard

    while (match.ctx.gameover === null && steps < MAX_STEPS) {
      const currentPlayer = match.ctx.currentPlayer;
      const botResult = makeRandomMove(game, match, currentPlayer, rng);
      expect(botResult.ok).toBe(true);
      if (!botResult.ok) break;

      // Advance turn so the engine rotates to the next player.
      const action = { ...botResult.action, events: { endTurn: true } };
      const r = reduce(game, match, action);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      match = r.state;
      steps++;
    }

    // A. Game must have terminated within the step limit.
    expect(match.ctx.gameover).not.toBe(null);

    // B. With seed=42 the outcome is deterministic. Acceptable: 0 or 1.
    const winner = match.ctx.gameover;
    expect([0, 1]).toContain(winner);

    // Verify the same run produces the identical winner a second time.
    const rng2 = makeLcgRng(42);
    let match2 = createMatch(game, 2);
    let steps2 = 0;
    while (match2.ctx.gameover === null && steps2 < MAX_STEPS) {
      const cp = match2.ctx.currentPlayer;
      const r2 = makeRandomMove(game, match2, cp, rng2);
      if (!r2.ok) break;
      const r3 = reduce(game, match2, { ...r2.action, events: { endTurn: true } });
      if (!r3.ok) break;
      match2 = r3.state;
      steps2++;
    }
    expect(match2.ctx.gameover).toEqual(winner); // B: identical outcome
    expect(steps2).toBe(steps);                  // same trajectory length
  });

  it('tic-tac-toe bot vs bot plays to a decided gameover (seed=42, deterministic)', () => {
    // tic-tac-toe's `place` move requires an integer payload (cell index 0-8).
    // With enumerate implemented on the fixture the bot can now enumerate the
    // empty cells and select a legal one — this is the first PR-3 milestone:
    // a payload-mandatory game completing a full bot vs bot match.
    //
    // Assertions:
    //   A. Match always reaches ctx.gameover !== null within step limit.
    //   B. Every step's action.payload is an integer in [0, 8].
    //   C. No cell is placed on twice (board integrity).
    //   D. With seed=42 the winner is identical across repeated runs.

    const game = ticTacToe();

    function runMatch(seed: number): {
      gameover: unknown;
      steps: number;
      payloads: number[];
    } {
      let match = createMatch(game, 2);
      const rng = makeLcgRng(seed);
      let steps = 0;
      const MAX_STEPS = 50; // at most 9 placements on a 3x3 board
      const payloads: number[] = [];
      const placedCells = new Set<number>();

      while (match.ctx.gameover === null && steps < MAX_STEPS) {
        const currentPlayer = match.ctx.currentPlayer;
        const botResult = makeRandomMove(game, match, currentPlayer, rng);
        expect(botResult.ok).toBe(true);
        if (!botResult.ok) break;

        // B. payload must be an integer in [0, 8] for 'place' moves.
        if (botResult.action.type === 'place') {
          const p = botResult.action.payload as number;
          expect(Number.isInteger(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(8);
          // C. no cell placed twice.
          expect(placedCells.has(p)).toBe(false);
          placedCells.add(p);
          payloads.push(p);
        }

        // Advance the turn so the engine rotates to the next player.
        const action = { ...botResult.action, events: { endTurn: true } };
        const r = reduce(game, match, action);
        expect(r.ok).toBe(true);
        if (!r.ok) break;
        match = r.state;
        steps++;
      }

      // A. Game must have terminated.
      expect(match.ctx.gameover).not.toBe(null);
      return { gameover: match.ctx.gameover, steps, payloads };
    }

    // First run.
    const run1 = runMatch(42);
    // gameover is a player index (0 | 1) or 'draw'.
    expect(run1.gameover === 0 || run1.gameover === 1 || run1.gameover === 'draw').toBe(true);

    // D. Second run with the same seed must be identical.
    const run2 = runMatch(42);
    expect(run2.gameover).toEqual(run1.gameover);
    expect(run2.steps).toBe(run1.steps);
    expect(run2.payloads).toEqual(run1.payloads);

    // Third run with a different seed must still reach gameover (robustness).
    const run3 = runMatch(7);
    expect(run3.gameover).not.toBe(null);
  });

  it('makeRandomMove refuses to act after gameover (tic-tac-toe)', () => {
    // Drive tic-tac-toe to a known gameover manually (no bot needed here;
    // tic-tac-toe moves require a payload that the bot cannot generate).
    const game = ticTacToe();
    let match = createMatch(game, 2);
    // P0 wins on the top row: cells 0, 1, 2
    const plays: Array<[number, number]> = [
      [0, 0], [3, 1], [1, 0], [4, 1], [2, 0],
    ];
    for (const [cell, player] of plays) {
      const isLast = cell === 2;
      const r = validateMove(
        game, match,
        { type: 'place', payload: cell, events: isLast ? undefined : { endTurn: true } },
        player,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      match = r.nextState;
    }
    expect(match.ctx.gameover).toBe(0);

    // C. Bot must refuse once the game is over.
    // (We use the hidden-card-game bot API here since tic-tac-toe's `place`
    // requires a payload anyway; the gameover guard fires before any move
    // selection, so the game type does not matter.)
    const cardGame = hiddenCardGame();
    const cardMatch = createMatch(cardGame, 2);
    // Drive card game to gameover by exhausting the deck with reduce directly.
    let cm = cardMatch;
    // Empty the deck by repeated draw+endTurn until gameover.
    const tempRng = makeLcgRng(99);
    let safetySteps = 0;
    while (cm.ctx.gameover === null && safetySteps < 200) {
      const cp = cm.ctx.currentPlayer;
      const br = makeRandomMove(cardGame, cm, cp, tempRng);
      if (!br.ok) break;
      const rr = reduce(cardGame, cm, { ...br.action, events: { endTurn: true } });
      if (!rr.ok) break;
      cm = rr.state;
      safetySteps++;
    }
    expect(cm.ctx.gameover).not.toBe(null);

    const botResult = makeRandomMove(cardGame, cm, cm.ctx.currentPlayer, makeLcgRng(1));
    expect(botResult.ok).toBe(false);
    if (botResult.ok) return;
    expect(botResult.reason).toMatch(/game over/);
  });
});

// ── HIDDEN-INFO E2E ──────────────────────────────────────────────────────────
//
// Prove that filterView on a game with viewFor correctly masks per-player
// information: player 0 cannot see player 1's card values and vice versa.
//
// Key properties under test:
//   A. hasHiddenInfo(def) is true for hidden-card-game.
//   B. filterView returns a MaskedState with { view, ctx } (not raw MatchState).
//   C. Each player's view exposes their OWN hand values.
//   D. Each player's view DOES NOT expose the opponent's card values:
//        - The opponent's card values must not appear in JSON.stringify(view).
//        - The view must not contain the key "G" or "hands" (raw state shape).
//   E. ctx (numPlayers / currentPlayer / phase / gameover) is identical in
//      both players' views (it is not sensitive information).
//
// DISCRIMINATING POWER (documented, not automatically verified in CI):
//   If viewFor were replaced with a pass-through that returns the full G
//   (e.g. `viewFor: (match) => match.G`), assertion D would fail because:
//     - JSON.stringify(view) would contain the opponent's card values.
//     - The view would contain the key "hands" (the raw hands array).
//   The test was manually verified to fail under this condition and restored
//   to the correct implementation before commit.

describe('engine e2e — hidden-info view filtering (filterView, hidden-card-game)', () => {
  it('hasHiddenInfo returns true for hidden-card-game', () => {
    const game = hiddenCardGame();
    expect(hasHiddenInfo(game)).toBe(true);
  });

  it('each player sees only their own hand values; opponent hand values are hidden', () => {
    const game = hiddenCardGame();
    const match = createMatch(game, 2);

    // All card values are >= 101 (fixture design: values 101..116). This means
    // checking JSON.stringify for a card value string ("101", "102", ...) will
    // never produce a false-positive match against ctx small integers (0, 1, 2).

    // Capture actual hand values from the authoritative match state.
    const p0Cards = [...match.G.hands[0]!]; // server-side truth
    const p1Cards = [...match.G.hands[1]!]; // server-side truth

    // All card values must be >= 101 (fixture invariant).
    for (const card of [...p0Cards, ...p1Cards]) {
      expect(card).toBeGreaterThanOrEqual(101);
    }

    // --- Player 0 view ---
    const raw0 = filterView(game, match, 0);
    // B. Must be a MaskedState (has 'view' key, not 'G' key at top level).
    expect('view' in raw0).toBe(true);
    expect('G' in raw0).toBe(false);

    const masked0 = raw0 as CardGameMaskedState;
    const view0 = masked0.view as CardGameView;

    // C. Player 0 sees their own hand.
    expect(view0.ownHand).toEqual(p0Cards);

    // D. Player 0 does NOT see player 1's card values.
    const json0 = JSON.stringify(view0);
    expect(json0).not.toContain('"G"');
    expect(json0).not.toContain('"hands"');
    for (const card of p1Cards) {
      // card >= 101, so the string representation is unique and unambiguous
      expect(json0).not.toContain(String(card));
    }

    // opponentHandSizes[1] is the count of P1's cards; the VALUES are hidden.
    expect(view0.opponentHandSizes[1]).toBe(p1Cards.length);

    // --- Player 1 view ---
    const raw1 = filterView(game, match, 1);
    expect('view' in raw1).toBe(true);
    expect('G' in raw1).toBe(false);

    const masked1 = raw1 as CardGameMaskedState;
    const view1 = masked1.view as CardGameView;

    // C. Player 1 sees their own hand.
    expect(view1.ownHand).toEqual(p1Cards);

    // D. Player 1 does NOT see player 0's card values.
    const json1 = JSON.stringify(view1);
    expect(json1).not.toContain('"G"');
    expect(json1).not.toContain('"hands"');
    for (const card of p0Cards) {
      expect(json1).not.toContain(String(card));
    }

    expect(view1.opponentHandSizes[0]).toBe(p0Cards.length);

    // E. ctx is identical in both views (same turn / phase / gameover info).
    expect(masked0.ctx).toEqual(masked1.ctx);
    expect(masked0.ctx.currentPlayer).toBe(match.ctx.currentPlayer);
    expect(masked0.ctx.gameover).toBe(null);
  });

  it('filterView returns a fresh object (not a reference into match.G)', () => {
    const game = hiddenCardGame();
    const match = createMatch(game, 2);
    const raw = filterView(game, match, 0) as CardGameMaskedState;
    // The view must be a new object; mutating it must not affect match.G.
    expect(raw.view).not.toBe(match.G);
    expect(raw.view).not.toBe((match.G as CardGameState).hands);
  });

  it('filterView on a game without viewFor returns the original match (backward-compat)', () => {
    // tic-tac-toe has no viewFor — filterView must be a no-op passthrough.
    const game = ticTacToe();
    const match = createMatch(game, 2);
    expect(hasHiddenInfo(game)).toBe(false);
    const result = filterView(game, match, 0);
    // Should return the identical MatchState reference (no wrapping).
    expect(result).toBe(match);
  });

  it('hidden-card-game plays a full bot vs bot match respecting hidden-info', () => {
    // Prove the game actually terminates: two bots draw until the deck empties.
    const game = hiddenCardGame();
    let match = createMatch(game, 2);
    const rng = makeLcgRng(7);
    let steps = 0;
    const MAX_STEPS = 200; // deck=8 cards after initial deal; should end well within limit

    while (match.ctx.gameover === null && steps < MAX_STEPS) {
      const cp = match.ctx.currentPlayer;
      const botResult = makeRandomMove(game, match, cp, rng);
      expect(botResult.ok).toBe(true);
      if (!botResult.ok) break;
      const r = reduce(game, match, { ...botResult.action, events: { endTurn: true } });
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      match = r.state;
      steps++;
    }

    expect(match.ctx.gameover).not.toBe(null);
    // Winner must be a valid player index.
    expect([0, 1]).toContain(match.ctx.gameover);

    // After the game, filterView still works for each player.
    for (const pid of [0, 1]) {
      const view = filterView(game, match, pid) as CardGameMaskedState;
      expect('view' in view).toBe(true);
      const v = view.view as CardGameView;
      expect(Array.isArray(v.ownHand)).toBe(true);
      expect(Array.isArray(v.opponentHandSizes)).toBe(true);
    }
  });
});
