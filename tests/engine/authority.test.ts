/**
 * authority.test.ts
 *
 * Unit tests for server-authoritative move validation (`validateMove`).
 * ⚠️ Security-sensitive: this is the防作弊 root. Tests are written as ATTACK
 * VECTORS to prove the authority layer rejects spoofing / out-of-turn / illegal
 * moves, and that the server can recompute the next state from its OWN held
 * state without trusting anything the client sends.
 *
 * Attack vectors asserted:
 *   ① player A sends an action carrying player=B          → rejected (spoof)
 *   ② action from a player whose turn it is NOT           → rejected (not your turn)
 *   ③ a move not allowed by the current phase             → rejected (phase)
 *   ④ a legal move: server-recomputed nextState           → deep-equals the
 *      result of calling reduce() directly on the server-held prevMatch,
 *      proving the server can recompute INDEPENDENTLY without any client state.
 *
 * Plus: no client-supplied state is ever read (validateMove takes only def,
 * the server-held prevMatch, the action, and the authenticated playerId), and
 * there is no "validate fails but apply anyway" fall-through.
 */

import { describe, it, expect } from 'vitest';
import {
  defineGame,
  createMatch,
  reduce,
  validateMove,
} from '../../src/engine/index.js';
import type {
  GameDefinition,
  MoveFn,
  MatchState,
} from '../../src/engine/index.js';

// ── A small 2-phase game used across the authority tests ────────────────────
// State logs which player ids acted, so we can assert state transitions.

interface PlayState {
  readonly placed: readonly number[];
  readonly drawn: readonly number[];
}

const place: MoveFn<PlayState> = (state, ctx) => ({
  placed: [...state.placed, ctx.currentPlayer],
  drawn: [...state.drawn],
});

const draw: MoveFn<PlayState> = (state, ctx) => ({
  placed: [...state.placed],
  drawn: [...state.drawn, ctx.currentPlayer],
});

function makeGame(): GameDefinition<PlayState> {
  return defineGame<PlayState>({
    name: 'authority-fixture',
    setup: () => ({ placed: [], drawn: [] }),
    moves: { place, draw },
    turn: { minPlayers: 2, maxPlayers: 4, order: 'sequential' },
    // Two phases: only `place` is legal in the 'play' phase, only `draw` in
    // the 'upkeep' phase. Used to exercise phase-illegal rejection.
    phases: {
      play: { moves: ['place'], next: 'upkeep' },
      upkeep: { moves: ['draw'], next: 'play' },
    },
  });
}

function makeMatch(): MatchState<PlayState> {
  // 2-player match; currentPlayer starts at 0, phase starts at 'play'.
  return createMatch(makeGame(), 2);
}

describe('validateMove — attack vectors (security-sensitive)', () => {
  // ── ① spoof: acting player A sends an action claiming player = B ───────────
  it('rejects a spoofed action.player that disagrees with the authenticated playerId', () => {
    const def = makeGame();
    const match = makeMatch();
    // It IS player 0's turn (currentPlayer === 0). Player 0 is authenticated,
    // but the action self-reports player = 1 (spoof attempt).
    const result = validateMove(def, match, { type: 'place', player: 1 }, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('player spoof');
    }
  });

  // ── ② out of turn: a player acts when it is not their turn ─────────────────
  it("rejects an action from a player whose turn it is not", () => {
    const def = makeGame();
    const match = makeMatch(); // currentPlayer === 0
    // Player 1 (authenticated) tries to act on player 0's turn.
    const result = validateMove(def, match, { type: 'place' }, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not your turn');
    }
  });

  // ── ③ phase-illegal: a move not permitted by the current phase ─────────────
  it('rejects a move not allowed in the current phase', () => {
    const def = makeGame();
    const match = makeMatch(); // phase === 'play' (only 'place' allowed)
    // Player 0 (correct turn, no spoof) requests 'draw', illegal in 'play'.
    const result = validateMove(def, match, { type: 'draw' }, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('not allowed in phase');
    }
  });

  // ── ④ legal move: server recomputes nextState independently ────────────────
  it('accepts a legal move and the server-recomputed nextState deep-equals a direct reduce on the server-held match', () => {
    const def = makeGame();
    const match = makeMatch(); // currentPlayer 0, phase 'play'
    const action = { type: 'place', events: { endTurn: true } } as const;

    // Authority path: server validates + recomputes from its OWN prevMatch.
    const authResult = validateMove(def, match, action, 0);
    // Reference path: reduce() on the SAME server-held match, no client state.
    const ref = reduce(def, match, action);

    expect(authResult.ok).toBe(true);
    expect(ref.ok).toBe(true);
    if (authResult.ok && ref.ok) {
      // Server recomputed the SAME state reduce would produce — proving the
      // server needs nothing from the client beyond the requested action.
      expect(authResult.nextState).toEqual(ref.state);
      // And it actually advanced the turn / recorded the move.
      expect(authResult.nextState.G.placed).toEqual([0]);
      expect(authResult.nextState.ctx.currentPlayer).toBe(1);
      expect(authResult.nextState.ctx.phase).toBe('upkeep');
    }
  });
});

describe('validateMove — does not trust the client / no fall-through', () => {
  // The signature itself proves the point: there is no parameter for a
  // client-supplied nextState/gameState. The server recomputes from prevMatch.
  it('recomputes from the server-held prevMatch and never mutates it', () => {
    const def = makeGame();
    const match = makeMatch();
    const before = structuredClone(match);

    const result = validateMove(def, match, { type: 'place', events: { endTurn: true } }, 0);

    expect(result.ok).toBe(true);
    // prevMatch (server's source of truth) is untouched — purity preserved.
    expect(match).toEqual(before);
  });

  it('rejects before recomputing when identity fails (spoof short-circuits reduce)', () => {
    const def = makeGame();
    const match = makeMatch();
    // Even if the requested move WOULD be legal, a spoof must be rejected and
    // must NOT produce a nextState (no "validate fails but apply anyway").
    const result = validateMove(def, match, { type: 'place', player: 99 }, 0);

    expect(result.ok).toBe(false);
    expect('nextState' in result).toBe(false);
  });

  it('passes through reduce rejections (e.g. unknown move) as a reason', () => {
    const def = makeGame();
    const match = makeMatch();
    // Correct player, no spoof, but an unknown move id — reduce rejects, and
    // validateMove surfaces it as a reason rather than applying anything.
    const result = validateMove(def, match, { type: 'nope' }, 0);

    expect(result.ok).toBe(false);
    expect('nextState' in result).toBe(false);
  });

  it('allows an action.player that matches the authenticated playerId', () => {
    const def = makeGame();
    const match = makeMatch();
    // Honest client that correctly self-reports its own id is allowed.
    const result = validateMove(def, match, { type: 'place', player: 0 }, 0);

    expect(result.ok).toBe(true);
  });
});
