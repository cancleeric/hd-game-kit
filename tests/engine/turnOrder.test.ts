/**
 * turnOrder.test.ts
 *
 * Unit tests for the pure turn-order strategies in src/engine/turnOrder.ts.
 *
 * Covers:
 *   - 'sequential' advances and wraps (2/3/4 players),
 *   - single-player wraps back to itself,
 *   - default (undefined order) behaves as 'sequential',
 *   - a function strategy returns its computed next player,
 *   - invalid function results (out of range / non-integer) are rejected,
 *   - determinism: same ctx twice → same next player.
 */

import { describe, it, expect } from 'vitest';
import { nextPlayer, TurnOrderError } from '../../src/engine/turnOrder.js';
import type { GameContext } from '../../src/engine/index.js';

function ctxFor(numPlayers: number, currentPlayer: number): GameContext {
  return { numPlayers, currentPlayer, phase: null, gameover: null };
}

describe('nextPlayer — sequential', () => {
  it('single player wraps back to itself', () => {
    expect(nextPlayer(ctxFor(1, 0), 'sequential')).toBe(0);
  });

  it('2 players: 0 → 1 → 0', () => {
    expect(nextPlayer(ctxFor(2, 0), 'sequential')).toBe(1);
    expect(nextPlayer(ctxFor(2, 1), 'sequential')).toBe(0);
  });

  it('3 players: full cycle 0 → 1 → 2 → 0', () => {
    expect(nextPlayer(ctxFor(3, 0), 'sequential')).toBe(1);
    expect(nextPlayer(ctxFor(3, 1), 'sequential')).toBe(2);
    expect(nextPlayer(ctxFor(3, 2), 'sequential')).toBe(0);
  });

  it('4 players: last player wraps to 0', () => {
    expect(nextPlayer(ctxFor(4, 0), 'sequential')).toBe(1);
    expect(nextPlayer(ctxFor(4, 1), 'sequential')).toBe(2);
    expect(nextPlayer(ctxFor(4, 2), 'sequential')).toBe(3);
    expect(nextPlayer(ctxFor(4, 3), 'sequential')).toBe(0);
  });

  it('defaults to sequential when order is undefined', () => {
    expect(nextPlayer(ctxFor(3, 1))).toBe(2);
    expect(nextPlayer(ctxFor(3, 2))).toBe(0);
  });
});

describe('nextPlayer — function strategy', () => {
  it('returns the value computed by the function', () => {
    // Reverse order: go backwards, wrapping.
    const reverse = (ctx: GameContext) =>
      (ctx.currentPlayer - 1 + ctx.numPlayers) % ctx.numPlayers;
    expect(nextPlayer(ctxFor(4, 0), reverse)).toBe(3);
    expect(nextPlayer(ctxFor(4, 2), reverse)).toBe(1);
  });

  it('can skip players (e.g. always player 0)', () => {
    const alwaysZero = () => 0;
    expect(nextPlayer(ctxFor(4, 2), alwaysZero)).toBe(0);
  });

  it('rejects an out-of-range result', () => {
    const tooBig = (ctx: GameContext) => ctx.numPlayers; // == numPlayers, out of range
    expect(() => nextPlayer(ctxFor(3, 0), tooBig)).toThrow(TurnOrderError);
  });

  it('rejects a negative result', () => {
    const negative = () => -1;
    expect(() => nextPlayer(ctxFor(3, 0), negative)).toThrow(TurnOrderError);
  });

  it('rejects a non-integer result', () => {
    const fractional = () => 1.5;
    expect(() => nextPlayer(ctxFor(3, 0), fractional)).toThrow(TurnOrderError);
  });
});

describe('nextPlayer — guards and determinism', () => {
  it('rejects an invalid numPlayers', () => {
    expect(() => nextPlayer(ctxFor(0, 0), 'sequential')).toThrow(TurnOrderError);
  });

  it('is deterministic: same ctx twice → same next player', () => {
    const ctx = ctxFor(4, 2);
    expect(nextPlayer(ctx, 'sequential')).toBe(nextPlayer(ctx, 'sequential'));
  });
});
