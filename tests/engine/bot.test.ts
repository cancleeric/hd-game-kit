/**
 * tests/engine/bot.test.ts
 *
 * Unit tests for `makeRandomMove` (src/engine/bot.ts).
 *
 * Coverage (per PR-3 plan):
 *   1. Determinism: injecting a fixed rng produces the same move on every call.
 *   2. Game-over guard: returns { ok: false, reason: 'game over' }.
 *   3. Turn guard: wrong playerId → { ok: false, reason: 'not your turn' }.
 *   4. Happy path: nextState deep-equals result of independent validateMove call.
 *   5. No-valid-move edge: all moves rejected → { ok: false, reason: 'no valid move found' }.
 *
 * Fixtures used:
 *   - `counterGame`  — a no-payload game with two moves (`inc`, `dec`); no phases.
 *     The bot can walk it without any payload. Used for cases 1, 3, 4.
 *   - `phasedGame`   — two phases: `a` only allows `noop`; in phase `b` the only
 *     declared move is `alwaysFail` (always throws). Used for case 5.
 *   - `gameoverGame` — same as counterGame but seeded already at gameover. Used
 *     for case 2.
 *
 * Importing from the public engine subpath to catch any export omissions.
 */

import { describe, it, expect } from 'vitest';
import {
  defineGame,
  createMatch,
  reduce,
  validateMove,
  makeRandomMove,
} from '../../src/engine/index.js';
import type { BotResult, GameDefinition, MatchState, MoveFn } from '../../src/engine/index.js';

// ── fixture helpers ──────────────────────────────────────────────────────────

/** Simple counter state. */
interface CounterState {
  readonly count: number;
}

/**
 * A two-move, no-payload, no-phase game.
 * `inc` increments the counter; `dec` decrements it.
 * No phases → both moves always legal. No victory condition → game runs forever
 * unless the caller drives endTurn / gameover externally.
 */
function counterGame(): GameDefinition<CounterState> {
  return defineGame<CounterState>({
    name: 'counter',
    setup: () => ({ count: 0 }),
    moves: {
      inc: (s) => ({ count: s.count + 1 }),
      dec: (s) => ({ count: s.count - 1 }),
    },
    turn: { minPlayers: 2, maxPlayers: 4 },
  });
}

/**
 * Same counter definition but with a victory hook that fires as soon as the
 * match is created — used to produce a match where `ctx.gameover !== null`
 * from the very first state, so the bot should refuse to act.
 *
 * We achieve this by running `reduce` manually with a winning move.
 */
function makeGameoverMatch(): {
  def: GameDefinition<CounterState>;
  match: MatchState<CounterState>;
} {
  const def = defineGame<CounterState>({
    name: 'counter-with-victory',
    setup: () => ({ count: 0 }),
    moves: {
      inc: (s) => ({ count: s.count + 1 }),
    },
    turn: { minPlayers: 2, maxPlayers: 2 },
    // Victory fires as soon as count >= 1.
    victory: (s) => (s.count >= 1 ? 'winner' : null),
  });
  const initial = createMatch(def, 2);
  // Apply one move so victory fires.
  const r = reduce(def, initial, { type: 'inc' });
  if (!r.ok) throw new Error('fixture setup failed');
  return { def, match: r.state };
}

/** A move that always throws, signalling an illegal action. */
const alwaysFail: MoveFn<CounterState> = () => {
  throw new Error('this move always fails');
};

/**
 * Two-phase game where:
 *   - phase `a` allows `noop` (succeeds with no change).
 *   - phase `b` only allows `alwaysFail` (always throws → validateMove rejects).
 *
 * Used to test the no-valid-move edge case: bot enters phase `b` and all
 * candidate moves are rejected by validateMove.
 */
function phasedGame(): GameDefinition<CounterState> {
  return defineGame<CounterState>({
    name: 'phased',
    setup: () => ({ count: 0 }),
    moves: {
      noop: (s) => ({ count: s.count }),
      alwaysFail,
    },
    turn: { minPlayers: 1, maxPlayers: 2 },
    phases: {
      a: { moves: ['noop'], next: 'b' },
      b: { moves: ['alwaysFail'] },
    },
  });
}

/** Drive a match into phase `b` where `alwaysFail` is the only legal move. */
function matchInPhaseB(): { def: GameDefinition<CounterState>; match: MatchState<CounterState> } {
  const def = phasedGame();
  const initial = createMatch(def, 1);
  expect(initial.ctx.phase).toBe('a');
  // noop + endTurn → transitions to phase b.
  const r = reduce(def, initial, { type: 'noop', events: { endTurn: true } });
  if (!r.ok) throw new Error('fixture: phase transition failed');
  expect(r.state.ctx.phase).toBe('b');
  return { def, match: r.state };
}

// ── test 1: determinism via rng injection ────────────────────────────────────

describe('makeRandomMove — determinism', () => {
  it('produces the same move on every call when given the same fixed rng', () => {
    const def = counterGame();
    const match = createMatch(def, 2);
    // A fixed rng that always returns 0 — deterministic shuffle.
    const fixedRng = () => 0;

    const results: BotResult<CounterState>[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(makeRandomMove(def, match, 0, fixedRng));
    }

    // All 10 calls must succeed.
    expect(results.every((r) => r.ok)).toBe(true);

    // All chosen actions must be identical (same move id, same player).
    const firstAction = results[0]!;
    if (!firstAction.ok) throw new Error('expected ok');
    for (const r of results) {
      if (!r.ok) throw new Error('expected ok');
      expect(r.action.type).toBe(firstAction.action.type);
      expect(r.action.player).toBe(firstAction.action.player);
    }
  });

  it('different fixed rng values may yield different moves (coverage of shuffled ordering)', () => {
    const def = counterGame();
    const match = createMatch(def, 2);

    // rng always returning 0 → first slot is always chosen.
    const r0 = makeRandomMove(def, match, 0, () => 0);
    // rng always returning 0.999 → last slot is always chosen.
    const r1 = makeRandomMove(def, match, 0, () => 0.999);

    expect(r0.ok).toBe(true);
    expect(r1.ok).toBe(true);
    if (!r0.ok || !r1.ok) return;
    // With two moves (inc/dec) the two fixed rngs should pick opposite moves.
    expect(r0.action.type).not.toBe(r1.action.type);
  });
});

// ── test 2: game-over guard ──────────────────────────────────────────────────

describe('makeRandomMove — game-over guard', () => {
  it("returns { ok: false, reason: 'game over' } when ctx.gameover is not null", () => {
    const { def, match } = makeGameoverMatch();
    expect(match.ctx.gameover).not.toBe(null);

    const r = makeRandomMove(def, match, match.ctx.currentPlayer);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('game over');
  });
});

// ── test 3: turn guard ───────────────────────────────────────────────────────

describe('makeRandomMove — turn guard', () => {
  it("returns { ok: false, reason: 'not your turn' } for a non-current player", () => {
    const def = counterGame();
    const match = createMatch(def, 2);
    // Match starts with player 0 to act; ask bot to play as player 1.
    expect(match.ctx.currentPlayer).toBe(0);

    const r = makeRandomMove(def, match, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not your turn');
  });
});

// ── test 4: happy path — nextState deep-equals independent validateMove ──────

describe('makeRandomMove — happy path', () => {
  it('nextState deep-equals the result of an independent validateMove call', () => {
    const def = counterGame();
    const match = createMatch(def, 2);
    const fixedRng = () => 0;

    const botResult = makeRandomMove(def, match, 0, fixedRng);
    expect(botResult.ok).toBe(true);
    if (!botResult.ok) return;

    // Re-run the same action through validateMove independently.
    const independent = validateMove(def, match, botResult.action, 0);
    expect(independent.ok).toBe(true);
    if (!independent.ok) return;

    // nextState from both paths must be deep-equal.
    expect(botResult.nextState).toEqual(independent.nextState);
  });

  it('the chosen action carries the correct player field', () => {
    const def = counterGame();
    const match = createMatch(def, 2);

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.action.player).toBe(0);
  });

  it('nextState also deep-equals the result of reduce with the same action', () => {
    const def = counterGame();
    const match = createMatch(def, 2);
    const fixedRng = () => 0.999;

    const botResult = makeRandomMove(def, match, 0, fixedRng);
    expect(botResult.ok).toBe(true);
    if (!botResult.ok) return;

    const reduced = reduce(def, match, botResult.action);
    expect(reduced.ok).toBe(true);
    if (!reduced.ok) return;

    expect(botResult.nextState).toEqual(reduced.state);
  });

  it('respects phase: only picks moves from the current phase', () => {
    // phasedGame phase `a` only allows `noop`.
    const def = phasedGame();
    const match = createMatch(def, 1);
    expect(match.ctx.phase).toBe('a');

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.action.type).toBe('noop');
  });
});

// ── test 5: no-valid-move edge case ─────────────────────────────────────────

describe('makeRandomMove — no valid move edge case', () => {
  it("returns { ok: false, reason: 'no valid move found' } when all moves fail", () => {
    const { def, match } = matchInPhaseB();
    // Phase `b` only declares `alwaysFail`, which always throws in validateMove.
    const r = makeRandomMove(def, match, match.ctx.currentPlayer);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no valid move found');
  });
});

// ── test 6: enumerate contract validation (PR-4 / PR-1) ─────────────────────
// Validates that defineGame enforces the enumerate contract.
// PR-1 only adds the type and the defineGame check; bot enumerate-path tests
// are deferred to PR-2 (bot.ts not yet modified).

describe('defineGame — enumerate contract', () => {
  it('accepts a valid function as enumerate', () => {
    expect(() =>
      defineGame<CounterState>({
        name: 'counter-with-enumerate',
        setup: () => ({ count: 0 }),
        moves: {
          inc: (s) => ({ count: s.count + 1 }),
        },
        turn: { minPlayers: 1, maxPlayers: 2 },
        enumerate: (_match, _moveId, _playerId) => [],
      }),
    ).not.toThrow();
  });

  it('throws when enumerate is provided but is not a function', () => {
    expect(() =>
      defineGame<CounterState>({
        name: 'counter-bad-enumerate',
        setup: () => ({ count: 0 }),
        moves: {
          inc: (s) => ({ count: s.count + 1 }),
        },
        turn: { minPlayers: 1, maxPlayers: 2 },
        // @ts-expect-error intentional contract violation for runtime test
        enumerate: 'not-a-function',
      }),
    ).toThrow('defineGame: enumerate must be a function when provided');
  });

  it('omitting enumerate leaves existing game behaviour unchanged', () => {
    // counterGame has no enumerate; makeRandomMove must still work as in R3.
    const def = counterGame();
    const match = createMatch(def, 2);
    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
  });
});
