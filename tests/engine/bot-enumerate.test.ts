/**
 * tests/engine/bot-enumerate.test.ts
 *
 * Unit tests for the `enumerate` path in `makeRandomMove` (PR-2 of Round 4).
 *
 * Coverage:
 *   (a) Enumerate-path determinism: fixed rng + same match => same type+payload
 *       every call.
 *   (b) Payload present in returned action: action.payload !== undefined and
 *       equals one of the values enumerate returned.
 *   (c) enumerate returns [] for a moveId => that move is skipped;
 *       all moves return [] => { ok: false, reason: 'no valid move found' }.
 *   (d) Backward-compat: no enumerate on def => existing counter game still works
 *       (same as R3 bot.test.ts happy path).
 *
 * Fixtures (inline, no external files changed):
 *   - `enumerableCounterGame` — counter with `place` (payload = integer >= 0)
 *     and `inc` (no payload). enumerate returns [0, 1, 2] for `place`; [] for
 *     anything else. `place` accepts any non-negative integer payload.
 *   - `allEmptyEnumerateGame` — all moves return [] from enumerate.
 *   - `counterGame` — plain no-enumerate counter (backward-compat fixture).
 */

import { describe, it, expect } from 'vitest';
import {
  defineGame,
  createMatch,
  reduce,
  makeRandomMove,
} from '../../src/engine/index.js';
import type { GameDefinition, MatchState, MoveFn } from '../../src/engine/index.js';

// ── fixture: counter state ───────────────────────────────────────────────────

interface CounterState {
  readonly count: number;
}

// ── fixture (a/b/c): game with enumerate ────────────────────────────────────

/**
 * A simple game that has two moves:
 *   - `place`: expects a non-negative integer payload; adds it to count.
 *   - `inc`:   no payload; increments count by 1.
 *
 * `enumerate` returns [10, 20, 30] for `place`, [] for `inc`.
 * This means the bot will always use the enumerate path and pick from
 * [10, 20, 30] for `place`; `inc` is skipped (empty enumerate).
 *
 * Using a fixed rng we can predict the exact payload chosen.
 */
function enumerableGame(): GameDefinition<CounterState> {
  const place: MoveFn<CounterState> = (state, _ctx, payload) => {
    if (typeof payload !== 'number' || payload < 0) {
      throw new Error('place: payload must be a non-negative number');
    }
    return { count: state.count + payload };
  };
  const inc: MoveFn<CounterState> = (state) => ({ count: state.count + 1 });

  return defineGame<CounterState>({
    name: 'enumerable-counter',
    setup: () => ({ count: 0 }),
    moves: { place, inc },
    turn: { minPlayers: 2, maxPlayers: 4 },
    enumerate: (_match, moveId, _playerId) => {
      if (moveId === 'place') return [10, 20, 30];
      return []; // `inc` => empty => bot skips it
    },
  });
}

/**
 * Same structure but all moves return [] from enumerate.
 * The bot should return { ok: false, reason: 'no valid move found' }.
 */
function allEmptyEnumerateGame(): GameDefinition<CounterState> {
  return defineGame<CounterState>({
    name: 'all-empty-enumerate',
    setup: () => ({ count: 0 }),
    moves: {
      inc: (s) => ({ count: s.count + 1 }),
      dec: (s) => ({ count: s.count - 1 }),
    },
    turn: { minPlayers: 1, maxPlayers: 2 },
    enumerate: () => [], // always empty
  });
}

/**
 * Backward-compat fixture: plain no-enumerate counter.
 * Identical to the counterGame in bot.test.ts — kept inline to avoid coupling.
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
    // no enumerate
  });
}

// ── (a) enumerate-path determinism ───────────────────────────────────────────

describe('makeRandomMove — enumerate path determinism', () => {
  it('produces the same type+payload on every call when given the same fixed rng', () => {
    const def = enumerableGame();
    const match = createMatch(def, 2);
    const fixedRng = () => 0; // deterministic

    const results = Array.from({ length: 10 }, () =>
      makeRandomMove(def, match, 0, fixedRng),
    );

    expect(results.every((r) => r.ok)).toBe(true);

    const first = results[0]!;
    if (!first.ok) throw new Error('expected ok');

    for (const r of results) {
      if (!r.ok) throw new Error('expected ok');
      expect(r.action.type).toBe(first.action.type);
      expect(r.action.payload).toBe(first.action.payload);
    }
  });

  it('different fixed rng values may select different payloads', () => {
    const def = enumerableGame();
    const match = createMatch(def, 2);

    // rng=0 picks from one end of the shuffled candidates
    const r0 = makeRandomMove(def, match, 0, () => 0);
    // rng=0.999 picks from the other end
    const r1 = makeRandomMove(def, match, 0, () => 0.999);

    expect(r0.ok).toBe(true);
    expect(r1.ok).toBe(true);
    if (!r0.ok || !r1.ok) return;

    // Both must carry a payload from [10, 20, 30] and same move type 'place'
    expect(r0.action.type).toBe('place');
    expect(r1.action.type).toBe('place');
    expect([10, 20, 30]).toContain(r0.action.payload);
    expect([10, 20, 30]).toContain(r1.action.payload);

    // The two rngs should yield different payloads (3-element list, shuffle differs)
    expect(r0.action.payload).not.toBe(r1.action.payload);
  });
});

// ── (b) payload present in returned action ───────────────────────────────────

describe('makeRandomMove — enumerate path payload', () => {
  it('action.payload is not undefined and comes from enumerate list', () => {
    const def = enumerableGame();
    const match = createMatch(def, 2);

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // payload must be defined (not undefined)
    expect(r.action.payload).not.toBeUndefined();

    // payload must be one of the values enumerate returned for 'place'
    expect([10, 20, 30]).toContain(r.action.payload);
  });

  it('action.type is the move that enumerate provided candidates for', () => {
    const def = enumerableGame();
    const match = createMatch(def, 2);

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // enumerate returns [] for 'inc', so bot must have chosen 'place'
    expect(r.action.type).toBe('place');
  });

  it('nextState reflects the payload that was applied', () => {
    const def = enumerableGame();
    const match = createMatch(def, 2);
    const fixedRng = () => 0;

    const r = makeRandomMove(def, match, 0, fixedRng);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The payload was added to count; nextState.G.count must equal payload
    expect(typeof r.action.payload).toBe('number');
    expect(r.nextState.G.count).toBe(r.action.payload as number);
  });
});

// ── (c) enumerate returns [] => skip move / all-empty => no valid move ────────

describe('makeRandomMove — enumerate empty handling', () => {
  it('skips a moveId whose enumerate returns [] and succeeds with another', () => {
    // enumerableGame: 'inc' => [], 'place' => [10,20,30]
    // Bot should skip 'inc' entirely and pick 'place'
    const def = enumerableGame();
    const match = createMatch(def, 2);

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // 'inc' was skipped because enumerate returned []
    expect(r.action.type).toBe('place');
  });

  it("returns { ok: false, reason: 'no valid move found' } when all moves enumerate to []", () => {
    const def = allEmptyEnumerateGame();
    const match = createMatch(def, 1);

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no valid move found');
  });

  it('game-over guard still fires before enumerate path', () => {
    // Build a game with enumerate that immediately gameovers
    const defRaw = defineGame<CounterState>({
      name: 'instant-gameover-enumerate',
      setup: () => ({ count: 0 }),
      moves: {
        inc: (s) => ({ count: s.count + 1 }),
      },
      turn: { minPlayers: 1, maxPlayers: 2 },
      victory: (s) => (s.count >= 1 ? 'winner' : null),
      enumerate: (_match, moveId) => {
        if (moveId === 'inc') return [1];
        return [];
      },
    });
    // Manually advance to gameover
    const initial = createMatch(defRaw, 1);
    const stepped = reduce(defRaw, initial, { type: 'inc' });
    if (!stepped.ok) throw new Error('fixture setup failed');
    const gameoverMatch: MatchState<CounterState> = stepped.state;
    expect(gameoverMatch.ctx.gameover).not.toBe(null);

    const r = makeRandomMove(defRaw, gameoverMatch, gameoverMatch.ctx.currentPlayer);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('game over');
  });
});

// ── (d) backward-compat: no enumerate => R3 behaviour ───────────────────────

describe('makeRandomMove — backward-compat (no enumerate)', () => {
  it('counter game still works when no enumerate is defined', () => {
    const def = counterGame();
    const match = createMatch(def, 2);

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Payload-free move: type is 'inc' or 'dec'
    expect(['inc', 'dec']).toContain(r.action.type);
  });

  it('no-enumerate determinism matches R3 behaviour (fixed rng)', () => {
    const def = counterGame();
    const match = createMatch(def, 2);
    const fixedRng = () => 0;

    const results = Array.from({ length: 10 }, () =>
      makeRandomMove(def, match, 0, fixedRng),
    );

    expect(results.every((r) => r.ok)).toBe(true);

    const first = results[0]!;
    if (!first.ok) throw new Error('expected ok');

    for (const r of results) {
      if (!r.ok) throw new Error('expected ok');
      expect(r.action.type).toBe(first.action.type);
    }
  });

  it('no-enumerate: action.payload is undefined (legacy behaviour)', () => {
    const def = counterGame();
    const match = createMatch(def, 2);

    const r = makeRandomMove(def, match, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The legacy path sends no payload
    expect(r.action.payload).toBeUndefined();
  });
});
