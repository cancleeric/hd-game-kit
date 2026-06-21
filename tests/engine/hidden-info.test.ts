/**
 * hidden-info.test.ts
 *
 * Unit tests for the hidden-information system:
 *
 * PR-1 scope — type contract:
 *   - `viewFor?` optional hook on `GameDefinition<G>`
 *   - `MaskedState<V>` type
 *   - `defineGame` contract validation of the `viewFor` field
 *
 * PR-2 scope — filterView() / hasHiddenInfo() implementation:
 *   (F) filterView returns MaskedState<V> when viewFor is present.
 *   (G) ATTACK VECTOR: filtered view for player N must not contain any
 *       information belonging exclusively to other players.
 *   (H) filterView returns original MatchState (deep-equal) when viewFor
 *       is absent (backward-compatible passthrough).
 *   (I) hasHiddenInfo returns true/false correctly.
 *   (J) filterView does NOT mutate the match argument.
 *   (K) filterView returns a new object on every call (no shared refs
 *       between calls for the same playerId).
 *
 * Backward-compatibility guarantee:
 *   All 119 existing tests are unaffected — new exports are additive only.
 */

import { describe, it, expect } from 'vitest';
import { defineGame, createMatch, filterView, hasHiddenInfo } from '../../src/engine/index.js';
import type {
  GameDefinition,
  MaskedState,
  MatchState,
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

// ===========================================================================
// PR-2: filterView() and hasHiddenInfo() — implementation tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Toy fixture for attack-vector tests: a card game where each player holds a
// private hand. Only the hand owner may see the card VALUES; others see only
// the hand SIZE.
//
// G = { hands: number[][] }   — hands[i] = card values for player i
// View = { ownHand: number[]; opponentHandSizes: number[] }
// ---------------------------------------------------------------------------

interface CardG {
  hands: number[][];
}

interface CardView {
  ownHand: number[];
  opponentHandSizes: number[];
}

const cardGameDef: GameDefinition<CardG> = {
  name: 'card-game-hidden',
  setup: (ctx) => ({
    // Player i receives cards [i*10+1, i*10+2, i*10+3]
    hands: Array.from({ length: ctx.numPlayers }, (_, i) => [
      i * 10 + 1,
      i * 10 + 2,
      i * 10 + 3,
    ]),
  }),
  moves: {
    playCard: (state, _ctx, payload) => {
      const { player, card } = payload as { player: number; card: number };
      return {
        hands: state.hands.map((hand, idx) =>
          idx === player ? hand.filter((c) => c !== card) : hand,
        ),
      };
    },
  },
  turn: { minPlayers: 2, maxPlayers: 4 },
  viewFor(match: MatchState<CardG>, playerId: number): CardView {
    return {
      // Own cards: full values
      ownHand: [...match.G.hands[playerId]],
      // Opponents: only the count, NOT the values
      opponentHandSizes: match.G.hands
        .map((hand, idx) => (idx === playerId ? -1 : hand.length))
        .filter((size) => size !== -1),
    };
  },
};

// ---------------------------------------------------------------------------
// F) filterView returns MaskedState<CardView> when viewFor is present
// ---------------------------------------------------------------------------

describe('filterView — returns MaskedState when viewFor is present', () => {
  it('returns an object with view and ctx keys for player 0', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const result = filterView<CardG, CardView>(def, match, 0);
    // Must be a MaskedState (has view and ctx), not a MatchState (has G and ctx)
    expect(result).toHaveProperty('view');
    expect(result).toHaveProperty('ctx');
    expect(result).not.toHaveProperty('G');
  });

  it('view.ownHand contains the correct cards for player 0', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const result = filterView<CardG, CardView>(def, match, 0) as MaskedState<CardView>;
    // Player 0 cards: [1, 2, 3]
    expect(result.view.ownHand).toEqual([1, 2, 3]);
  });

  it('view.ownHand contains the correct cards for player 1', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const result = filterView<CardG, CardView>(def, match, 1) as MaskedState<CardView>;
    // Player 1 cards: [11, 12, 13]
    expect(result.view.ownHand).toEqual([11, 12, 13]);
  });

  it('ctx is preserved (as a defensive copy) from the original match', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const result = filterView<CardG, CardView>(def, match, 0) as MaskedState<CardView>;
    // ctx content (turn/phase/gameover) is preserved unchanged...
    expect(result.ctx).toEqual(match.ctx);
    // ...but it is a fresh object — the alias to the engine's ctx is severed so
    // callers cannot mutate the engine (or another player's view) through it.
    expect(result.ctx).not.toBe(match.ctx);
  });
});

// ---------------------------------------------------------------------------
// G) ATTACK VECTOR: opponent card values MUST NOT appear in the view
// ---------------------------------------------------------------------------

describe('filterView — ATTACK VECTOR: opponent information must not leak', () => {
  it('player 0 view does NOT contain player 1 card VALUES', () => {
    const def = defineGame(cardGameDef);
    // 2-player match: player 0 cards [1,2,3], player 1 cards [11,12,13]
    const match = createMatch(def, 2);
    const result = filterView<CardG, CardView>(def, match, 0) as MaskedState<CardView>;

    // Serialise the entire result to string — player 1's card values (11,12,13)
    // must NOT appear anywhere in the output.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('11');
    expect(serialised).not.toContain('12');
    expect(serialised).not.toContain('13');

    // Must also not expose the full hands array
    expect(serialised).not.toContain('"hands"');
    expect(serialised).not.toContain('"G"');
  });

  it('player 1 view does NOT contain player 0 card VALUES', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const result = filterView<CardG, CardView>(def, match, 1) as MaskedState<CardView>;

    const serialised = JSON.stringify(result);
    // Player 0's cards are 1, 2, 3 — but note "1" might appear in ctx
    // (currentPlayer:0, numPlayers:2 etc.), so check for specific card values
    // by checking ownHand only contains p1's cards and opponentHandSizes is counts-only.
    expect(result.view.ownHand).toEqual([11, 12, 13]);
    // opponentHandSizes should be [3] (p0 has 3 cards), not [1, 2, 3]
    expect(result.view.opponentHandSizes).toEqual([3]);
    expect(serialised).not.toContain('"hands"');
    expect(serialised).not.toContain('"G"');
  });

  it('4-player match: each player only sees own hand values', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 4);
    // Player cards: p0=[1,2,3], p1=[11,12,13], p2=[21,22,23], p3=[31,32,33]

    for (let pid = 0; pid < 4; pid++) {
      const result = filterView<CardG, CardView>(def, match, pid) as MaskedState<CardView>;
      const ownBase = pid * 10;
      expect(result.view.ownHand).toEqual([ownBase + 1, ownBase + 2, ownBase + 3]);
      // opponentHandSizes should have 3 entries, each = 3 (all opponents have 3 cards)
      expect(result.view.opponentHandSizes).toEqual([3, 3, 3]);
      // The raw full-G must not leak
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain('"G"');
      expect(serialised).not.toContain('"hands"');
    }
  });
});

// ---------------------------------------------------------------------------
// H) filterView backward-compat: no viewFor → returns original MatchState
// ---------------------------------------------------------------------------

describe('filterView — backward-compat: no viewFor returns original MatchState', () => {
  const plainDef: GameDefinition<{ x: number }> = {
    name: 'plain-no-hidden',
    setup: () => ({ x: 42 }),
    moves: {
      inc: (s) => ({ x: s.x + 1 }),
    },
    turn: { minPlayers: 1, maxPlayers: 2 },
    // no viewFor
  };

  it('returns the same reference as the input match', () => {
    const def = defineGame(plainDef);
    const match = createMatch(def, 1);
    const result = filterView(def, match, 0);
    // For no-hidden-info games the exact same MatchState reference is returned
    expect(result).toBe(match);
  });

  it('returned value is deep-equal to the input match', () => {
    const def = defineGame(plainDef);
    const match = createMatch(def, 1);
    const result = filterView(def, match, 0);
    expect(result).toEqual(match);
  });

  it('returned value has G and ctx (MatchState shape, NOT MaskedState)', () => {
    const def = defineGame(plainDef);
    const match = createMatch(def, 1);
    const result = filterView(def, match, 0);
    expect(result).toHaveProperty('G');
    expect(result).toHaveProperty('ctx');
    expect(result).not.toHaveProperty('view');
  });
});

// ---------------------------------------------------------------------------
// I) hasHiddenInfo returns correct boolean
// ---------------------------------------------------------------------------

describe('hasHiddenInfo', () => {
  it('returns true for a game that declares viewFor', () => {
    const def = defineGame(cardGameDef);
    expect(hasHiddenInfo(def)).toBe(true);
  });

  it('returns true for the hiddenGameDef fixture', () => {
    const def = defineGame(hiddenGameDef);
    expect(hasHiddenInfo(def)).toBe(true);
  });

  it('returns false for a game WITHOUT viewFor', () => {
    const plainDef: GameDefinition<{ x: number }> = {
      name: 'no-hidden-2',
      setup: () => ({ x: 0 }),
      moves: { noop: (s) => s },
      turn: { minPlayers: 1, maxPlayers: 2 },
    };
    const def = defineGame(plainDef);
    expect(hasHiddenInfo(def)).toBe(false);
  });

  it('returns false when viewFor is explicitly undefined', () => {
    const defObj: GameDefinition<{ x: number }> = {
      name: 'explicit-undef',
      setup: () => ({ x: 0 }),
      moves: { noop: (s) => s },
      turn: { minPlayers: 1, maxPlayers: 2 },
      viewFor: undefined,
    };
    const def = defineGame(defObj);
    expect(hasHiddenInfo(def)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// J) filterView does NOT mutate the match argument
// ---------------------------------------------------------------------------

describe('filterView — purity: match must not be mutated', () => {
  it('does not mutate match.G.hands after filterView call', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const handsBefore = match.G.hands.map((h) => [...h]);
    filterView(def, match, 0);
    filterView(def, match, 1);
    expect(match.G.hands).toEqual(handsBefore);
  });

  it('does not mutate match.ctx after filterView call', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const ctxSnapshot = { ...match.ctx };
    filterView(def, match, 0);
    expect(match.ctx).toEqual(ctxSnapshot);
  });
});

// ---------------------------------------------------------------------------
// K) filterView returns a NEW view object on each call (no shared references)
// ---------------------------------------------------------------------------

describe('filterView — no shared references between calls', () => {
  it('two calls for the same playerId produce different view object references', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const r1 = filterView<CardG, CardView>(def, match, 0) as MaskedState<CardView>;
    const r2 = filterView<CardG, CardView>(def, match, 0) as MaskedState<CardView>;
    // Different MaskedState objects
    expect(r1).not.toBe(r2);
    // Different view objects
    expect(r1.view).not.toBe(r2.view);
    // But values must be equal
    expect(r1.view).toEqual(r2.view);
  });

  it('view.ownHand is NOT the same array reference as match.G.hands[playerId]', () => {
    const def = defineGame(cardGameDef);
    const match = createMatch(def, 2);
    const result = filterView<CardG, CardView>(def, match, 0) as MaskedState<CardView>;
    // ownHand must be a copy, not a live ref into match.G
    expect(result.view.ownHand).not.toBe(match.G.hands[0]);
    // But values must match
    expect(result.view.ownHand).toEqual(match.G.hands[0]);
  });
});
