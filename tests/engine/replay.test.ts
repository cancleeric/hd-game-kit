/**
 * tests/engine/replay.test.ts
 *
 * Unit tests for the `replayMatch` pure function (R6 PR-2 + Q2-3).
 *
 * T-R01 — empty log  → length 1 (only initial state)
 * T-R02 — N-step log → N+1 snapshots; each snapshot's G is readable
 * T-R03 — tic-tac-toe 3-step replay matches direct-reduce result (deep-equal)
 * T-R04 — corrupted log entry → throws with step index in message
 * T-R05 — gameover state is preserved correctly through replay
 * T-R06 — snapshot[k].log.length === k (time-travel invariant)
 * T-R07 — initialState (Q2-3): backward-compat when omitted
 * T-R08 — initialState (Q2-3): injected state is used verbatim as snapshots[0]
 * T-R09 — initialState (Q2-3): non-deterministic setup game replays correctly
 * T-R10 — initialState (Q2-3): def.setup is NOT called when initialState supplied
 */

import { describe, it, expect, vi } from 'vitest';
import { defineGame, createMatch, createMatchFromState, reduce, replayMatch } from '../../src/engine/index.js';
import type { GameDefinition, MatchState, MoveFn, MoveRecord } from '../../src/engine/index.js';
import { ticTacToe } from './fixtures/tic-tac-toe.js';
import type { TicTacToeState } from './fixtures/tic-tac-toe.js';

// ── Counter fixture (deterministic setup) ──────────────────────────────────

interface CounterState {
  count: number;
}

const inc: MoveFn<CounterState> = (state, _ctx, payload) => {
  const by = typeof payload === 'number' ? payload : 1;
  return { count: state.count + by };
};

function makeCounter(): GameDefinition<CounterState> {
  return defineGame<CounterState>({
    name: 'counter',
    setup: () => ({ count: 0 }),
    moves: { inc },
    turn: { minPlayers: 1, maxPlayers: 4 },
  });
}

// Helper: run reduce N times, collecting the log from the final state.
function buildLog(
  def: GameDefinition<CounterState>,
  actions: Array<{ type: string; payload?: unknown }>,
): { log: readonly MoveRecord[]; finalState: ReturnType<typeof createMatch<CounterState>> } {
  let match = createMatch(def, 1);
  for (const action of actions) {
    const r = reduce(def, match, action);
    if (!r.ok) throw new Error(`buildLog: reduce failed: ${r.error}`);
    match = r.state;
  }
  return { log: match.log, finalState: match };
}

// ── T-R01 ──────────────────────────────────────────────────────────────────

describe('T-R01: empty log → length 1 (only initial state)', () => {
  it('returns exactly one snapshot when log is empty', () => {
    const game = makeCounter();
    const snapshots = replayMatch(game, []);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.G).toEqual({ count: 0 });
    expect(snapshots[0]!.log).toHaveLength(0);
  });

  it('empty log replay equals createMatch directly', () => {
    const game = makeCounter();
    const initial = createMatch(game, 1);
    const snapshots = replayMatch(game, [], 1);
    expect(snapshots[0]!.G).toEqual(initial.G);
    expect(snapshots[0]!.ctx).toEqual(initial.ctx);
  });
});

// ── T-R02 ──────────────────────────────────────────────────────────────────

describe('T-R02: N-step log → N+1 snapshots; each G is readable', () => {
  it('3-step counter log produces 4 snapshots', () => {
    const game = makeCounter();
    const { log } = buildLog(game, [
      { type: 'inc' },
      { type: 'inc', payload: 2 },
      { type: 'inc', payload: 10 },
    ]);
    expect(log).toHaveLength(3);

    const snapshots = replayMatch(game, log, 1);
    expect(snapshots).toHaveLength(4);

    // snapshot[0] is initial
    expect(snapshots[0]!.G.count).toBe(0);
    // snapshot[1] after first inc (by 1)
    expect(snapshots[1]!.G.count).toBe(1);
    // snapshot[2] after second inc (by 2)
    expect(snapshots[2]!.G.count).toBe(3);
    // snapshot[3] after third inc (by 10)
    expect(snapshots[3]!.G.count).toBe(13);
  });

  it('1-step log produces 2 snapshots', () => {
    const game = makeCounter();
    const { log } = buildLog(game, [{ type: 'inc', payload: 5 }]);
    const snapshots = replayMatch(game, log, 1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]!.G.count).toBe(5);
  });
});

// ── T-R03 ──────────────────────────────────────────────────────────────────

describe('T-R03: tic-tac-toe 3-step replay matches direct-reduce', () => {
  it('snapshot[3].G and ctx deep-equal the state from direct reduce', () => {
    const game = ticTacToe();

    // Build the 3-step sequence directly (opening phase: only 'place' allowed)
    // Step 1: player 0 places at cell 0, endTurn → transitions to 'play', player 1
    // Step 2: player 1 places at cell 4, no endTurn → same player
    // Step 3: player 1 passes (legal in 'play'), endTurn → back to player 0
    const actions = [
      { type: 'place', payload: 0, events: { endTurn: true } as const },
      { type: 'place', payload: 4, events: { endTurn: true } as const },
      { type: 'place', payload: 1, events: { endTurn: true } as const },
    ];

    // Direct reduce path
    let direct = createMatch(game, 2);
    for (const action of actions) {
      const r = reduce(game, direct, action);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      direct = r.state;
    }

    // Replay path
    const snapshots = replayMatch(game, direct.log, 2);

    // snapshots has length 4 (initial + 3 steps)
    expect(snapshots).toHaveLength(4);

    const replayFinal = snapshots[3]!;

    // G deep-equal
    expect(replayFinal.G).toEqual(direct.G);
    // ctx deep-equal (currentPlayer, phase, gameover, numPlayers)
    expect(replayFinal.ctx).toEqual(direct.ctx);
    // Sanity: the board is no longer all-null
    const board = replayFinal.G as TicTacToeState;
    expect(board.board[0]).toBe(0); // player 0 placed at cell 0
    expect(board.board[4]).toBe(1); // player 1 placed at cell 4
  });
});

// ── T-R04 ──────────────────────────────────────────────────────────────────

describe('T-R04: corrupted log entry → throws with step info', () => {
  it('throws when log entry has an unknown move type', () => {
    const game = makeCounter();
    const { log } = buildLog(game, [{ type: 'inc' }, { type: 'inc' }]);

    // Corrupt the second entry: replace action type with an unknown move
    const corruptedLog: MoveRecord[] = [
      log[0]!,
      { ...log[1]!, action: { type: 'NONEXISTENT_MOVE' } },
    ];

    expect(() => replayMatch(game, corruptedLog, 1)).toThrow(/step 1/);
  });

  it('throws when a move rejects the payload (simulate invalid payload)', () => {
    // Build a game where 'inc' is strict about payload type (throws on string)
    const strictInc: MoveFn<CounterState> = (state, _ctx, payload) => {
      if (typeof payload !== 'number' && payload !== undefined) {
        throw new Error('inc: payload must be a number');
      }
      return { count: state.count + (typeof payload === 'number' ? payload : 1) };
    };
    const strictGame = defineGame<CounterState>({
      name: 'strict-counter',
      setup: () => ({ count: 0 }),
      moves: { inc: strictInc },
      turn: { minPlayers: 1, maxPlayers: 1 },
    });

    const { log } = buildLog(makeCounter(), [{ type: 'inc', payload: 1 }]);

    // Corrupt: inject a string payload that strictGame rejects
    const corruptedLog: MoveRecord[] = [
      { ...log[0]!, action: { type: 'inc', payload: 'bad-string-payload' } },
    ];

    expect(() => replayMatch(strictGame, corruptedLog, 1)).toThrow(/step 0/);
  });

  it('error message includes the action type that failed', () => {
    const game = makeCounter();
    const { log } = buildLog(game, [{ type: 'inc' }]);
    const corruptedLog: MoveRecord[] = [
      { ...log[0]!, action: { type: 'NO_SUCH_MOVE' } },
    ];

    let msg = '';
    try {
      replayMatch(game, corruptedLog, 1);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toMatch(/NO_SUCH_MOVE/);
    expect(msg).toMatch(/step 0/);
  });
});

// ── T-R05 ──────────────────────────────────────────────────────────────────

describe('T-R05: gameover state preserved through replay', () => {
  it('replays a game to gameover and snapshot reflects ctx.gameover', () => {
    const game = ticTacToe();

    // Play a winning sequence for player 0: cells 0, 3, 6 (first column)
    // opening phase: player 0 place(0) endTurn → play, player 1
    // play:          player 1 place(1) endTurn → play, player 0
    //                player 0 place(3) endTurn → play, player 1
    //                player 1 place(2) endTurn → play, player 0
    //                player 0 place(6) → victory check → player 0 wins
    const actions = [
      { type: 'place', payload: 0, events: { endTurn: true } as const },
      { type: 'place', payload: 1, events: { endTurn: true } as const },
      { type: 'place', payload: 3, events: { endTurn: true } as const },
      { type: 'place', payload: 2, events: { endTurn: true } as const },
      { type: 'place', payload: 6 }, // win for player 0; no endTurn needed
    ];

    let direct = createMatch(game, 2);
    for (const action of actions) {
      const r = reduce(game, direct, action);
      if (!r.ok) throw new Error(`setup failed: ${r.error}`);
      direct = r.state;
    }

    expect(direct.ctx.gameover).toBe(0); // player 0 wins

    const snapshots = replayMatch(game, direct.log, 2);
    const finalSnapshot = snapshots[snapshots.length - 1]!;
    expect(finalSnapshot.ctx.gameover).toBe(0);
    expect(finalSnapshot.G).toEqual(direct.G);
  });
});

// ── T-R06 ──────────────────────────────────────────────────────────────────

describe('T-R06: time-travel invariant — snapshot[k].log.length === k', () => {
  it('every snapshot carries exactly k log entries', () => {
    const game = makeCounter();
    const N = 5;
    const { log } = buildLog(
      game,
      Array.from({ length: N }, () => ({ type: 'inc' })),
    );

    const snapshots = replayMatch(game, log, 1);
    expect(snapshots).toHaveLength(N + 1);

    for (let k = 0; k <= N; k++) {
      expect(snapshots[k]!.log).toHaveLength(k);
    }
  });

  it('each snapshot is independently readable (no shared references)', () => {
    const game = makeCounter();
    const { log } = buildLog(game, [
      { type: 'inc', payload: 1 },
      { type: 'inc', payload: 2 },
      { type: 'inc', payload: 3 },
    ]);

    const snapshots = replayMatch(game, log, 1);

    // Verify counts independently without mutating
    expect(snapshots[0]!.G.count).toBe(0);
    expect(snapshots[1]!.G.count).toBe(1);
    expect(snapshots[2]!.G.count).toBe(3);
    expect(snapshots[3]!.G.count).toBe(6);

    // Verify log lengths
    expect(snapshots[0]!.log).toHaveLength(0);
    expect(snapshots[1]!.log).toHaveLength(1);
    expect(snapshots[2]!.log).toHaveLength(2);
    expect(snapshots[3]!.log).toHaveLength(3);
  });
});

// ── T-R07 (Q2-3) ───────────────────────────────────────────────────────────

describe('T-R07: backward-compat — omitting initialState preserves existing behaviour', () => {
  it('3-step replay without initialState still matches direct reduce', () => {
    const game = makeCounter();
    const { log, finalState } = buildLog(game, [
      { type: 'inc' },
      { type: 'inc', payload: 2 },
      { type: 'inc', payload: 10 },
    ]);

    const snapshots = replayMatch(game, log, 1);
    expect(snapshots).toHaveLength(4);
    expect(snapshots[3]!.G).toEqual(finalState.G);
    expect(snapshots[3]!.ctx).toEqual(finalState.ctx);
  });

  it('empty log without initialState still returns initial createMatch state', () => {
    const game = makeCounter();
    const direct = createMatch(game, 1);
    const snapshots = replayMatch(game, [], 1);
    expect(snapshots[0]!.G).toEqual(direct.G);
    expect(snapshots[0]!.ctx).toEqual(direct.ctx);
  });
});

// ── T-R08 (Q2-3) ───────────────────────────────────────────────────────────

describe('T-R08: initialState is used verbatim as snapshots[0]', () => {
  it('snapshots[0] equals the provided initialState (same reference)', () => {
    const game = makeCounter();
    const customInitial: MatchState<CounterState> = createMatchFromState(
      game,
      { count: 100 },
      1,
    );

    const snapshots = replayMatch(game, [], 1, customInitial);
    expect(snapshots[0]).toBe(customInitial);
  });

  it('log entries are applied on top of the injected initialState', () => {
    const game = makeCounter();
    // Start from count=100, replay two inc moves
    const customInitial: MatchState<CounterState> = createMatchFromState(
      game,
      { count: 100 },
      1,
    );

    // Build log moves separately (using count=0 as base, we just want the log entries)
    const { log } = buildLog(game, [
      { type: 'inc', payload: 5 },
      { type: 'inc', payload: 3 },
    ]);

    const snapshots = replayMatch(game, log, 1, customInitial);
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]!.G.count).toBe(100);
    expect(snapshots[1]!.G.count).toBe(105);
    expect(snapshots[2]!.G.count).toBe(108);
  });
});

// ── T-R09 (Q2-3) ───────────────────────────────────────────────────────────

describe('T-R09: non-deterministic setup game replays correctly with initialState', () => {
  it('replay diverges without initialState, converges with it', () => {
    // Simulate a game whose setup returns a different value each call (non-deterministic)
    let callCount = 0;
    const nondeterministicGame = defineGame<CounterState>({
      name: 'nondeterministic',
      setup: () => {
        callCount += 1;
        // Each call produces a different starting count
        return { count: callCount * 10 };
      },
      moves: { inc },
      turn: { minPlayers: 1, maxPlayers: 2 },
    });

    // Simulate original match: starts at count=10 (first setup call)
    const originalInitial = createMatch(nondeterministicGame, 1);
    expect(originalInitial.G.count).toBe(10); // callCount=1

    // Apply one move on top of the original initial state
    const r = reduce(nondeterministicGame, originalInitial, { type: 'inc', payload: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const afterMove = r.state;
    expect(afterMove.G.count).toBe(17);
    const gameLog = afterMove.log;

    // Without initialState: setup is called again → count starts at 20 (callCount=2)
    const divergedSnapshots = replayMatch(nondeterministicGame, gameLog, 1);
    // snapshots[0].G.count will be 20 (from second setup call), making final wrong
    expect(divergedSnapshots[0]!.G.count).not.toBe(10); // diverged!
    expect(divergedSnapshots[1]!.G.count).not.toBe(17); // result is wrong

    // With initialState: setup is NOT called again, replay is correct
    const correctSnapshots = replayMatch(nondeterministicGame, gameLog, 1, originalInitial);
    expect(correctSnapshots[0]!.G.count).toBe(10);  // original start
    expect(correctSnapshots[1]!.G.count).toBe(17);  // correct replay
  });
});

// ── T-R10 (Q2-3) ───────────────────────────────────────────────────────────

describe('T-R10: def.setup is NOT called when initialState is supplied', () => {
  it('setup spy records zero calls when initialState is provided', () => {
    const setupSpy = vi.fn((): CounterState => ({ count: 0 }));
    const game = defineGame<CounterState>({
      name: 'spy-replay-game',
      setup: setupSpy,
      moves: { inc },
      turn: { minPlayers: 1, maxPlayers: 2 },
    });

    const injectedInitial: MatchState<CounterState> = {
      G: { count: 42 },
      ctx: {
        numPlayers: 1,
        currentPlayer: 0,
        phase: null,
        gameover: null,
      },
      log: [],
    };

    replayMatch(game, [], 1, injectedInitial);

    expect(setupSpy).not.toHaveBeenCalled();
  });

  it('contrast: without initialState, setup IS called once', () => {
    const setupSpy = vi.fn((): CounterState => ({ count: 0 }));
    const game = defineGame<CounterState>({
      name: 'spy-replay-game-b',
      setup: setupSpy,
      moves: { inc },
      turn: { minPlayers: 1, maxPlayers: 2 },
    });

    replayMatch(game, [], 1);

    expect(setupSpy).toHaveBeenCalledTimes(1);
  });
});
