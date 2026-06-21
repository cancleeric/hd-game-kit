/**
 * hidden-info.test.ts
 *
 * Unit tests for the PR-1 hidden-information type contract:
 *   - `viewFor?` optional hook on `GameDefinition<G>`
 *   - `MaskedState<V>` type
 *   - `defineGame` contract validation of the `viewFor` field
 *
 * PR-1 scope: TYPE CONTRACT ONLY.
 * `filterView()` is NOT implemented in this PR (that is PR-2).
 * These tests prove:
 *   (A) A definition WITH a valid `viewFor` function passes `defineGame`.
 *   (B) A definition with `viewFor` set to a non-function throws.
 *   (C) A definition WITHOUT `viewFor` continues to pass (back-compat).
 *   (D) The `viewFor` hook can be called directly and returns a masked view
 *       (smoke-testing the pure-function semantics without filterView).
 *
 * Backward-compatibility guarantee:
 *   All 104 existing tests are unaffected — `viewFor` is an OPTIONAL field,
 *   existing game definitions without it pass unchanged.
 */

import { describe, it, expect } from 'vitest';
import { defineGame, createMatch } from '../../src/engine/index.js';
import type {
  GameDefinition,
  MatchState,
  MaskedState,
} from '../../src/engine/index.js';

// ---------------------------------------------------------------------------
// Toy fixture: a minimal hidden-info game where each player has a secret number.
// Player's view = { own: number; opponentCount: number }
// (opponent's actual value is hidden — only the count is exposed)
// ---------------------------------------------------------------------------

interface HiddenG {
  secrets: number[]; // secrets[i] = player i's secret number
}

interface HiddenView {
  own: number;          // the viewing player's own secret
  opponentCount: number; // how many opponents there are (not their values)
}

const hiddenGameDef: GameDefinition<HiddenG> = {
  name: 'hidden-number',
  setup: (ctx) => ({
    secrets: Array.from({ length: ctx.numPlayers }, (_, i) => (i + 1) * 10),
  }),
  moves: {
    reveal: (state, _ctx, payload) => {
      const idx = payload as number;
      const next = { secrets: [...state.secrets] };
      next.secrets[idx] = 0; // reveal by zeroing
      return next;
    },
  },
  turn: { minPlayers: 2, maxPlayers: 4 },
  viewFor(match: MatchState<HiddenG>, playerId: number): HiddenView {
    // Pure function: returns a NEW object, does not mutate match.
    return {
      own: match.G.secrets[playerId],
      opponentCount: match.G.secrets.length - 1,
    };
  },
};

// ---------------------------------------------------------------------------
// A) defineGame accepts a definition WITH a valid viewFor function
// ---------------------------------------------------------------------------

describe('defineGame — viewFor contract', () => {
  it('accepts a game definition that includes a viewFor function', () => {
    expect(() => defineGame(hiddenGameDef)).not.toThrow();
  });

  it('returns a frozen definition even when viewFor is present', () => {
    const frozen = defineGame(hiddenGameDef);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('preserves the viewFor function on the returned definition', () => {
    const frozen = defineGame(hiddenGameDef);
    expect(typeof frozen.viewFor).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// B) defineGame rejects viewFor that is NOT a function
// ---------------------------------------------------------------------------

describe('defineGame — viewFor type guard', () => {
  it('throws when viewFor is a string', () => {
    const bad = {
      ...hiddenGameDef,
      viewFor: 'not-a-function' as unknown as GameDefinition<HiddenG>['viewFor'],
    };
    expect(() => defineGame(bad)).toThrow(
      'defineGame: viewFor must be a function when provided',
    );
  });

  it('throws when viewFor is a number', () => {
    const bad = {
      ...hiddenGameDef,
      viewFor: 42 as unknown as GameDefinition<HiddenG>['viewFor'],
    };
    expect(() => defineGame(bad)).toThrow(
      'defineGame: viewFor must be a function when provided',
    );
  });

  it('throws when viewFor is a plain object', () => {
    const bad = {
      ...hiddenGameDef,
      viewFor: {} as unknown as GameDefinition<HiddenG>['viewFor'],
    };
    expect(() => defineGame(bad)).toThrow(
      'defineGame: viewFor must be a function when provided',
    );
  });

  it('throws when viewFor is null', () => {
    const bad = {
      ...hiddenGameDef,
      viewFor: null as unknown as GameDefinition<HiddenG>['viewFor'],
    };
    // null is not a function, should throw
    expect(() => defineGame(bad)).toThrow(
      'defineGame: viewFor must be a function when provided',
    );
  });
});

// ---------------------------------------------------------------------------
// C) Back-compat: existing games WITHOUT viewFor continue to pass defineGame
// ---------------------------------------------------------------------------

describe('defineGame — backward compatibility (no viewFor)', () => {
  const noViewForDef: GameDefinition<{ x: number }> = {
    name: 'no-hidden-info',
    setup: () => ({ x: 0 }),
    moves: {
      inc: (s) => ({ x: s.x + 1 }),
    },
    turn: { minPlayers: 1, maxPlayers: 2 },
    // viewFor is intentionally absent
  };

  it('passes defineGame without viewFor', () => {
    expect(() => defineGame(noViewForDef)).not.toThrow();
  });

  it('viewFor is undefined on the returned definition', () => {
    const frozen = defineGame(noViewForDef);
    expect(frozen.viewFor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D) viewFor pure-function semantics smoke test
// (filterView() body is PR-2; here we call viewFor directly from the def)
// ---------------------------------------------------------------------------

describe('viewFor — pure function semantics', () => {
  it('returns a view with the correct own value for player 0', () => {
    const def = defineGame(hiddenGameDef);
    const match = createMatch(def, 2);
    // setup: secrets = [10, 20]
    const view = def.viewFor!(match, 0) as HiddenView;
    expect(view.own).toBe(10);
    expect(view.opponentCount).toBe(1);
  });

  it('returns a view with the correct own value for player 1', () => {
    const def = defineGame(hiddenGameDef);
    const match = createMatch(def, 2);
    const view = def.viewFor!(match, 1) as HiddenView;
    expect(view.own).toBe(20);
    expect(view.opponentCount).toBe(1);
  });

  it('does NOT expose opponent secret value in view (hidden-info guarantee)', () => {
    const def = defineGame(hiddenGameDef);
    const match = createMatch(def, 2);

    const viewP0 = def.viewFor!(match, 0) as HiddenView;
    // player 0's view must NOT contain player 1's secret value (20)
    expect(JSON.stringify(viewP0)).not.toContain('"secrets"');
    // view only exposes own and opponentCount
    expect(Object.keys(viewP0)).toEqual(['own', 'opponentCount']);

    const viewP1 = def.viewFor!(match, 1) as HiddenView;
    expect(Object.keys(viewP1)).toEqual(['own', 'opponentCount']);
  });

  it('returns a NEW object each call (does not share references with match)', () => {
    const def = defineGame(hiddenGameDef);
    const match = createMatch(def, 2);
    const view1 = def.viewFor!(match, 0);
    const view2 = def.viewFor!(match, 0);
    // Each call returns a new object
    expect(view1).not.toBe(view2);
    // But values are equal
    expect(view1).toEqual(view2);
  });

  it('does NOT mutate match when viewFor is called', () => {
    const def = defineGame(hiddenGameDef);
    const match = createMatch(def, 2);
    const secretsBefore = [...match.G.secrets];
    def.viewFor!(match, 0);
    def.viewFor!(match, 1);
    // match must not be mutated
    expect(match.G.secrets).toEqual(secretsBefore);
  });
});

// ---------------------------------------------------------------------------
// E) MaskedState<V> type smoke test
// (Only type-level; we construct a MaskedState manually to verify the shape)
// ---------------------------------------------------------------------------

describe('MaskedState type', () => {
  it('can be constructed with a view and a ctx (type-level shape check)', () => {
    const def = defineGame(hiddenGameDef);
    const match = createMatch(def, 2);
    const rawView = def.viewFor!(match, 0) as HiddenView;

    // Construct a MaskedState<HiddenView> manually (PR-2 will use filterView)
    const masked: MaskedState<HiddenView> = {
      view: rawView,
      ctx: match.ctx,
    };

    expect(masked.view.own).toBe(10);
    expect(masked.ctx.numPlayers).toBe(2);
    expect(masked.ctx.currentPlayer).toBe(0);
  });
});
