/**
 * phases.test.ts
 *
 * Integration tests for the PR-2 turn state machine layered on reduce():
 *   - phase gating (move not allowed in phase → rejected),
 *   - no-phases back-compat (all moves allowed),
 *   - turn advancement via events.endTurn (2-4 players wrap correctly),
 *   - single-player turn (player stays 0),
 *   - phase transition on turn end via phase.next,
 *   - victory detection writes ctx.gameover and blocks further moves,
 *   - boundary: a phase that declares ZERO legal moves rejects everything,
 *   - determinism: replaying a full move sequence twice → deep-equal match.
 */

import { describe, it, expect } from 'vitest';
import { defineGame, createMatch, reduce } from '../../src/engine/index.js';
import type { GameDefinition, MatchState, MoveFn } from '../../src/engine/index.js';

// ── A small two-phase game: draw then play, win at score 3 ──────────────────

interface CardState {
  hand: number;
  score: number;
}

const draw: MoveFn<CardState> = (s) => ({ ...s, hand: s.hand + 1 });
const play: MoveFn<CardState> = (s) =>
  s.hand > 0 ? { hand: s.hand - 1, score: s.score + 1 } : (() => { throw new Error('empty hand'); })();
const noop: MoveFn<CardState> = (s) => ({ ...s });

function phasedGame(numPlayers = 2): GameDefinition<CardState> {
  return defineGame<CardState>({
    name: 'cards',
    setup: () => ({ hand: 0, score: 0 }),
    moves: { draw, play, noop },
    turn: { minPlayers: 1, maxPlayers: 4, order: 'sequential' },
    phases: {
      drawPhase: { moves: ['draw'], next: 'playPhase' },
      playPhase: { moves: ['play'], next: 'drawPhase' },
    },
    victory: (s) => (s.score >= 3 ? 'won' : null),
  });
}

// ── phase gating ────────────────────────────────────────────────────────────

describe('phase gating', () => {
  it('allows a move declared by the current phase', () => {
    const game = phasedGame();
    const match = createMatch(game, 2);
    expect(match.ctx.phase).toBe('drawPhase');
    const r = reduce(game, match, { type: 'draw' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.G.hand).toBe(1);
  });

  it('rejects a move not declared by the current phase', () => {
    const game = phasedGame();
    const match = createMatch(game, 2); // starts in drawPhase
    const r = reduce(game, match, { type: 'play' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/move not allowed in phase drawPhase/);
  });

  it('allows all moves when no phases are declared (PR-1 back-compat)', () => {
    const game = defineGame<CardState>({
      name: 'no-phases',
      setup: () => ({ hand: 5, score: 0 }),
      moves: { draw, play, noop },
      turn: { minPlayers: 1, maxPlayers: 2 },
    });
    const match = createMatch(game, 1);
    expect(match.ctx.phase).toBe(null);
    expect(reduce(game, match, { type: 'draw' }).ok).toBe(true);
    expect(reduce(game, match, { type: 'play' }).ok).toBe(true);
    expect(reduce(game, match, { type: 'noop' }).ok).toBe(true);
  });

  it('boundary: a phase declaring zero moves rejects everything', () => {
    const game = defineGame<CardState>({
      name: 'locked',
      setup: () => ({ hand: 0, score: 0 }),
      moves: { draw, play, noop },
      turn: { minPlayers: 1, maxPlayers: 2 },
      phases: {
        locked: { moves: [] },
      },
    });
    const match = createMatch(game, 1);
    expect(match.ctx.phase).toBe('locked');
    for (const type of ['draw', 'play', 'noop']) {
      const r = reduce(game, match, { type });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error).toMatch(/move not allowed in phase locked/);
    }
  });
});

// ── turn advancement ────────────────────────────────────────────────────────

describe('turn advancement via events.endTurn', () => {
  it('does not advance the player without endTurn', () => {
    const game = phasedGame();
    const r = reduce(game, createMatch(game, 3), { type: 'draw' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.currentPlayer).toBe(0);
    // phase only advances on turn end:
    expect(r.state.ctx.phase).toBe('drawPhase');
  });

  it('single-player: endTurn keeps the same player', () => {
    const game = phasedGame();
    const r = reduce(game, createMatch(game, 1), {
      type: 'draw',
      events: { endTurn: true },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.currentPlayer).toBe(0);
  });

  // A phase-free game so turn cycling is not affected by phase gating; `noop`
  // is always legal and never triggers victory.
  function turnGame(): GameDefinition<CardState> {
    return defineGame<CardState>({
      name: 'turns',
      setup: () => ({ hand: 0, score: 0 }),
      moves: { noop },
      turn: { minPlayers: 1, maxPlayers: 4, order: 'sequential' },
    });
  }

  it('2 players: endTurn cycles 0 → 1 → 0', () => {
    const game = turnGame();
    let match = createMatch(game, 2);
    const players: number[] = [match.ctx.currentPlayer];
    for (let i = 0; i < 2; i++) {
      const d = reduce(game, match, { type: 'noop', events: { endTurn: true } });
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      match = d.state;
      players.push(match.ctx.currentPlayer);
    }
    expect(players).toEqual([0, 1, 0]);
  });

  it('4 players: endTurn cycles 0 → 1 → 2 → 3 → 0', () => {
    const game = turnGame();
    let match = createMatch(game, 4);
    const seen: number[] = [match.ctx.currentPlayer];
    for (let i = 0; i < 4; i++) {
      const r = reduce(game, match, { type: 'noop', events: { endTurn: true } });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      match = r.state;
      seen.push(match.ctx.currentPlayer);
    }
    expect(seen).toEqual([0, 1, 2, 3, 0]);
  });

  it('function turn order is honoured on endTurn', () => {
    const reverse = defineGame<CardState>({
      name: 'reverse',
      setup: () => ({ hand: 0, score: 0 }),
      moves: { draw, play, noop },
      turn: {
        minPlayers: 4,
        maxPlayers: 4,
        order: (ctx) => (ctx.currentPlayer - 1 + ctx.numPlayers) % ctx.numPlayers,
      },
    });
    const r = reduce(reverse, createMatch(reverse, 4), {
      type: 'draw',
      events: { endTurn: true },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.currentPlayer).toBe(3); // 0 - 1 wraps to 3
  });
});

// ── phase transition on turn end ────────────────────────────────────────────

describe('phase transition on turn end', () => {
  it('moves to phase.next when the turn ends', () => {
    const game = phasedGame();
    const r = reduce(game, createMatch(game, 2), {
      type: 'draw',
      events: { endTurn: true },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.phase).toBe('playPhase');
  });

  it('stays in phase when the turn ends but phase has no next', () => {
    const game = defineGame<CardState>({
      name: 'one-phase',
      setup: () => ({ hand: 0, score: 0 }),
      moves: { draw, play, noop },
      turn: { minPlayers: 2, maxPlayers: 2 },
      phases: { only: { moves: ['draw'] } },
    });
    const r = reduce(game, createMatch(game, 2), {
      type: 'draw',
      events: { endTurn: true },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.phase).toBe('only');
    expect(r.state.ctx.currentPlayer).toBe(1);
  });
});

// ── victory ─────────────────────────────────────────────────────────────────

describe('victory detection', () => {
  it('writes ctx.gameover when victory is reached and blocks further moves', () => {
    // No-phases game so we can drive score to 3 freely.
    const game = defineGame<CardState>({
      name: 'race-to-3',
      setup: () => ({ hand: 9, score: 0 }),
      moves: { play },
      turn: { minPlayers: 1, maxPlayers: 2 },
      victory: (s) => (s.score >= 3 ? 'won' : null),
    });

    let match: MatchState<CardState> = createMatch(game, 1);
    for (let i = 0; i < 2; i++) {
      const r = reduce(game, match, { type: 'play' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.ctx.gameover).toBe(null);
      match = r.state;
    }
    // Third play reaches score 3 → gameover.
    const win = reduce(game, match, { type: 'play' });
    expect(win.ok).toBe(true);
    if (!win.ok) return;
    expect(win.state.G.score).toBe(3);
    expect(win.state.ctx.gameover).toBe('won');

    // Any further move is rejected.
    const after = reduce(game, win.state, { type: 'play' });
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error).toMatch(/game is over/);
  });

  it('does not advance the turn on the winning move even with endTurn', () => {
    const game = defineGame<CardState>({
      name: 'win-no-turn',
      setup: () => ({ hand: 9, score: 2 }),
      moves: { play },
      turn: { minPlayers: 2, maxPlayers: 2 },
      victory: (s) => (s.score >= 3 ? 'won' : null),
    });
    const r = reduce(game, createMatch(game, 2), {
      type: 'play',
      events: { endTurn: true },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ctx.gameover).toBe('won');
    expect(r.state.ctx.currentPlayer).toBe(0); // unchanged
  });
});

// ── determinism over a full sequence (CEO-required) ─────────────────────────

describe('determinism over a full move sequence', () => {
  function playFullGame(game: GameDefinition<CardState>): MatchState<CardState> {
    let match = createMatch(game, 4);
    const actions = [
      { type: 'draw', events: { endTurn: true } }, // p0 draw, → playPhase, p1
    ] as const;
    for (const a of actions) {
      const r = reduce(game, match, a);
      if (!r.ok) throw new Error(`unexpected rejection: ${r.error}`);
      match = r.state;
    }
    // then a play in playPhase, ending turn back to drawPhase, p2
    const r2 = reduce(game, match, { type: 'play', events: { endTurn: true } });
    if (!r2.ok) throw new Error(`unexpected rejection: ${r2.error}`);
    return r2.state;
  }

  it('same sequence twice → deep-equal match state', () => {
    const a = playFullGame(phasedGame());
    const b = playFullGame(phasedGame());
    expect(a).toEqual(b);
  });

  it('does not mutate the input match', () => {
    const game = phasedGame();
    const match = createMatch(game, 2);
    const snapshot = structuredClone(match);
    reduce(game, match, { type: 'draw', events: { endTurn: true } });
    expect(match).toEqual(snapshot);
  });
});
