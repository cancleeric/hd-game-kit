/**
 * tests/engine/injectMatch.test.ts
 *
 * Unit tests for `createMatchFromState` (Q2-2).
 *
 * T-I01 — returns { G, ctx, log:[] } using the provided G verbatim
 * T-I02 — ctx contains correct numPlayers, currentPlayer=0, gameover=null
 * T-I03 — ctx.phase equals initialPhase (same as createMatch)
 * T-I04 — numPlayers out of range → throws
 * T-I05 — def.setup is NOT called (spy verification)
 * T-I06 — default numPlayers falls back to def.turn.minPlayers
 */

import { describe, it, expect, vi } from 'vitest';
import {
  defineGame,
  createMatch,
  createMatchFromState,
} from '../../src/engine/index.js';
import type { GameDefinition, MoveFn } from '../../src/engine/index.js';

// ── Shared fixture ────────────────────────────────────────────────────────────

interface CounterState {
  count: number;
  label: string;
}

const noop: MoveFn<CounterState> = (state) => state;

function makeGame(): GameDefinition<CounterState> {
  return defineGame<CounterState>({
    name: 'counter',
    setup: () => ({ count: 0, label: 'default' }),
    moves: { noop },
    turn: { minPlayers: 1, maxPlayers: 4 },
  });
}

// ── T-I01 ────────────────────────────────────────────────────────────────────

describe('T-I01: returns { G, ctx, log: [] } using the provided G verbatim', () => {
  it('G is exactly the object passed in', () => {
    const game = makeGame();
    const customG: CounterState = { count: 42, label: 'injected' };
    const match = createMatchFromState(game, customG, 2);

    expect(match.G).toBe(customG); // same reference — not a copy
    expect(match.G.count).toBe(42);
    expect(match.G.label).toBe('injected');
  });

  it('log is an empty array', () => {
    const game = makeGame();
    const match = createMatchFromState(game, { count: 0, label: 'x' }, 1);
    expect(match.log).toHaveLength(0);
  });
});

// ── T-I02 ────────────────────────────────────────────────────────────────────

describe('T-I02: ctx contains correct numPlayers, currentPlayer=0, gameover=null', () => {
  it('numPlayers is set correctly', () => {
    const game = makeGame();
    const match = createMatchFromState(game, { count: 0, label: '' }, 3);
    expect(match.ctx.numPlayers).toBe(3);
  });

  it('currentPlayer is always 0', () => {
    const game = makeGame();
    const match = createMatchFromState(game, { count: 0, label: '' }, 2);
    expect(match.ctx.currentPlayer).toBe(0);
  });

  it('gameover is null', () => {
    const game = makeGame();
    const match = createMatchFromState(game, { count: 0, label: '' }, 2);
    expect(match.ctx.gameover).toBeNull();
  });
});

// ── T-I03 ────────────────────────────────────────────────────────────────────

describe('T-I03: ctx.phase equals initialPhase (same as createMatch)', () => {
  it('phase matches what createMatch would produce for the same def', () => {
    const game = makeGame();
    const fromState = createMatchFromState(game, { count: 0, label: '' }, 2);
    const fromSetup = createMatch(game, 2);
    expect(fromState.ctx.phase).toEqual(fromSetup.ctx.phase);
  });

  it('works with a phased game', () => {
    const phasedGame = defineGame<CounterState>({
      name: 'phased-counter',
      setup: () => ({ count: 0, label: '' }),
      moves: { noop },
      turn: { minPlayers: 1, maxPlayers: 2 },
      phases: {
        alpha: { moves: ['noop'], next: 'beta' },
        beta: { moves: ['noop'] },
      },
      initialPhase: 'alpha',
    });

    const fromState = createMatchFromState(phasedGame, { count: 0, label: '' }, 1);
    const fromSetup = createMatch(phasedGame, 1);
    expect(fromState.ctx.phase).toBe('alpha');
    expect(fromState.ctx.phase).toEqual(fromSetup.ctx.phase);
  });
});

// ── T-I04 ────────────────────────────────────────────────────────────────────

describe('T-I04: numPlayers out of range → throws', () => {
  it('throws when numPlayers is below minPlayers', () => {
    const game = makeGame(); // minPlayers=1
    expect(() =>
      createMatchFromState(game, { count: 0, label: '' }, 0),
    ).toThrow(/out of range/);
  });

  it('throws when numPlayers is above maxPlayers', () => {
    const game = makeGame(); // maxPlayers=4
    expect(() =>
      createMatchFromState(game, { count: 0, label: '' }, 5),
    ).toThrow(/out of range/);
  });

  it('throws when numPlayers is not an integer', () => {
    const game = makeGame();
    expect(() =>
      createMatchFromState(game, { count: 0, label: '' }, 1.5),
    ).toThrow();
  });
});

// ── T-I05 ────────────────────────────────────────────────────────────────────

describe('T-I05: def.setup is NOT called', () => {
  it('setup spy records zero calls when using createMatchFromState', () => {
    const setupSpy = vi.fn(() => ({ count: 99, label: 'from-setup' }));
    const game = defineGame<CounterState>({
      name: 'spy-game',
      setup: setupSpy,
      moves: { noop },
      turn: { minPlayers: 1, maxPlayers: 2 },
    });

    const injectedG: CounterState = { count: 7, label: 'injected' };
    const match = createMatchFromState(game, injectedG, 1);

    expect(setupSpy).not.toHaveBeenCalled();
    // The returned G is the injected one, not the spy's return value
    expect(match.G.count).toBe(7);
    expect(match.G.label).toBe('injected');
  });

  it('contrast: createMatch DOES call setup', () => {
    const setupSpy = vi.fn(() => ({ count: 99, label: 'from-setup' }));
    const game = defineGame<CounterState>({
      name: 'spy-game-b',
      setup: setupSpy,
      moves: { noop },
      turn: { minPlayers: 1, maxPlayers: 2 },
    });

    createMatch(game, 1);
    expect(setupSpy).toHaveBeenCalledTimes(1);
  });
});

// ── T-I06 ────────────────────────────────────────────────────────────────────

describe('T-I06: default numPlayers falls back to def.turn.minPlayers', () => {
  it('omitting numPlayers uses minPlayers', () => {
    const game = defineGame<CounterState>({
      name: 'min-default',
      setup: () => ({ count: 0, label: '' }),
      moves: { noop },
      turn: { minPlayers: 2, maxPlayers: 4 },
    });

    const match = createMatchFromState(game, { count: 0, label: '' });
    expect(match.ctx.numPlayers).toBe(2);
  });
});
