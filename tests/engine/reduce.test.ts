/**
 * reduce.test.ts
 *
 * Unit tests for the engine core: defineGame contract validation and the
 * deterministic, pure reduce(). PR-2 moved the reducer onto the match state
 * `{ G, ctx }`, so these tests build a match with `createMatch` and assert on
 * `result.state.G` (game state) and `result.state.ctx` (engine metadata).
 *
 * Asserts:
 *   - happy-path move application,
 *   - unknown move / non-action rejection,
 *   - move-throws → { ok: false },
 *   - DETERMINISM: same (match, action) reduced twice → deep-equal results,
 *   - PURITY: the input match/state is not mutated,
 *   - defineGame contract checks (name/setup/moves/turn) and freezing.
 */

import { describe, it, expect } from 'vitest';
import { defineGame, createMatch, reduce } from '../../src/engine/index.js';
import type { GameDefinition, MoveFn } from '../../src/engine/index.js';

// ── A tiny game used across tests ──────────────────────────────────────────
// State is a simple counter with a log of player ids that acted.

interface CounterState {
  count: number;
  actors: number[];
}

const inc: MoveFn<CounterState> = (state, _ctx, payload) => {
  const by = typeof payload === 'number' ? payload : 1;
  return { count: state.count + by, actors: [...state.actors] };
};

const recordPlayer: MoveFn<CounterState> = (state, _ctx, payload) => {
  const player = typeof payload === 'number' ? payload : 0;
  return { count: state.count, actors: [...state.actors, player] };
};

const boom: MoveFn<CounterState> = () => {
  throw new Error('illegal move');
};

function makeGame(): GameDefinition<CounterState> {
  return defineGame<CounterState>({
    name: 'counter',
    setup: () => ({ count: 0, actors: [] }),
    moves: { inc, recordPlayer, boom },
    turn: { minPlayers: 1, maxPlayers: 4 },
  });
}

// ── defineGame ─────────────────────────────────────────────────────────────

describe('defineGame contract validation', () => {
  it('accepts a valid definition and returns a frozen object', () => {
    const game = makeGame();
    expect(Object.isFrozen(game)).toBe(true);
    expect(Object.isFrozen(game.moves)).toBe(true);
    expect(Object.isFrozen(game.turn)).toBe(true);
    expect(game.name).toBe('counter');
  });

  it('runs setup to produce the initial state', () => {
    const game = makeGame();
    expect(
      game.setup({ numPlayers: 2, currentPlayer: 0, phase: null, gameover: null }),
    ).toEqual({ count: 0, actors: [] });
  });

  it('rejects an empty name', () => {
    expect(() =>
      defineGame<CounterState>({
        name: '   ',
        setup: () => ({ count: 0, actors: [] }),
        moves: { inc },
        turn: { minPlayers: 1, maxPlayers: 2 },
      }),
    ).toThrow(/name/i);
  });

  it('rejects an empty moves object', () => {
    expect(() =>
      defineGame<CounterState>({
        name: 'empty-moves',
        setup: () => ({ count: 0, actors: [] }),
        moves: {},
        turn: { minPlayers: 1, maxPlayers: 2 },
      }),
    ).toThrow(/moves/i);
  });

  it('rejects a non-function move', () => {
    expect(() =>
      defineGame<CounterState>({
        name: 'bad-move',
        setup: () => ({ count: 0, actors: [] }),
        // @ts-expect-error intentionally invalid move value for the test
        moves: { inc, broken: 42 },
        turn: { minPlayers: 1, maxPlayers: 2 },
      }),
    ).toThrow(/move "broken"/);
  });

  it('rejects minPlayers > maxPlayers', () => {
    expect(() =>
      defineGame<CounterState>({
        name: 'bad-turn',
        setup: () => ({ count: 0, actors: [] }),
        moves: { inc },
        turn: { minPlayers: 5, maxPlayers: 2 },
      }),
    ).toThrow(/minPlayers/);
  });

  it('rejects minPlayers < 1', () => {
    expect(() =>
      defineGame<CounterState>({
        name: 'zero-players',
        setup: () => ({ count: 0, actors: [] }),
        moves: { inc },
        turn: { minPlayers: 0, maxPlayers: 2 },
      }),
    ).toThrow(/minPlayers/);
  });
});

// ── reduce: happy path ──────────────────────────────────────────────────────

describe('reduce — applying a move', () => {
  it('applies a known move and returns the new match state', () => {
    const game = makeGame();
    const match = createMatch(game, 1);
    const result = reduce(game, match, { type: 'inc' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.G).toEqual({ count: 1, actors: [] });
    // No endTurn requested → same player, same (implicit) phase.
    expect(result.state.ctx.currentPlayer).toBe(0);
    expect(result.state.ctx.phase).toBe(null);
    expect(result.state.ctx.gameover).toBe(null);
  });

  it('passes payload through to the move', () => {
    const game = makeGame();
    const match = { G: { count: 10, actors: [] }, ctx: createMatch(game, 1).ctx };
    const result = reduce(game, match, { type: 'inc', payload: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.G.count).toBe(15);
  });

  it('passes action payload to a move that records it', () => {
    const game = makeGame();
    const match = createMatch(game, 1);
    const result = reduce(game, match, { type: 'recordPlayer', payload: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.G.actors).toEqual([3]);
  });
});

// ── reduce: rejection paths ─────────────────────────────────────────────────

describe('reduce — rejection paths', () => {
  it('returns ok:false for an unknown move type', () => {
    const game = makeGame();
    const result = reduce(game, createMatch(game, 1), { type: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unknown move "nope"/);
  });

  it('returns ok:false when a move throws', () => {
    const game = makeGame();
    const result = reduce(game, createMatch(game, 1), { type: 'boom' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/illegal move/);
  });

  it('returns ok:false for a malformed action without a string type', () => {
    const game = makeGame();
    // @ts-expect-error intentionally malformed action for the test
    const result = reduce(game, createMatch(game, 1), { payload: 1 });
    expect(result.ok).toBe(false);
  });
});

// ── reduce: determinism + purity (CEO-required) ─────────────────────────────

describe('reduce — determinism and purity', () => {
  it('is deterministic: same (match, action) twice → deep-equal results', () => {
    const game = makeGame();
    const match = { G: { count: 7, actors: [1, 2] }, ctx: createMatch(game, 1).ctx };
    const action = { type: 'inc', payload: 3 } as const;

    const r1 = reduce(game, match, action);
    const r2 = reduce(game, match, action);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1).toEqual(r2);
  });

  it('does not mutate the input match/state (before/after snapshot)', () => {
    const game = makeGame();
    const match = { G: { count: 7, actors: [1, 2] }, ctx: createMatch(game, 1).ctx };
    const snapshot = structuredClone(match);

    const result = reduce(game, match, { type: 'recordPlayer', payload: 9 });

    expect(result.ok).toBe(true);
    // The original match/state is unchanged …
    expect(match).toEqual(snapshot);
    // … and the result is a distinct object (new reference).
    if (!result.ok) return;
    expect(result.state.G).not.toBe(match.G);
    expect(result.state.G.actors).not.toBe(match.G.actors);
  });

  it('does not mutate a deeply frozen input game state', () => {
    const game = makeGame();
    const frozenG: CounterState = Object.freeze({
      count: 1,
      actors: Object.freeze([4]) as number[],
    });
    const match = { G: frozenG, ctx: createMatch(game, 1).ctx };

    // A pure move on frozen input must not throw (it must build a new object).
    const result = reduce(game, match, { type: 'recordPlayer', payload: 8 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.G.actors).toEqual([4, 8]);
    expect(frozenG.actors).toEqual([4]);
  });
});
