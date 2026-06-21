/**
 * tests/engine/fixtures/hidden-card-game.ts
 *
 * A minimal TOY game with hidden hand information, used by e2e-engine.test.ts
 * to prove "per-player view filtering" (filterView / viewFor) works end-to-end.
 *
 * ⛔ This is a TEST FIXTURE only — never shipped, never imported by src/.
 *
 * Game concept: "Draw & Discard"
 *   - Each player starts with a hand of 2 cards drawn from a shared deck.
 *   - On each turn the current player may `draw` (take the top deck card into
 *     hand) or `discard` (remove any card from hand). Either move may end the
 *     turn via events.endTurn.
 *   - The game ends when the deck is empty; the player holding the most
 *     cards wins.
 *
 * Hidden-info contract (the key property under test):
 *   - viewFor(match, playerId) returns a FRESH object containing:
 *       { ownHand: number[]; opponentHandSizes: number[] }
 *     where `ownHand` contains the caller's actual card values, while
 *     `opponentHandSizes` only exposes the count of each opponent's cards —
 *     the card VALUES are withheld.
 *
 * Card-value range: 101–116 (starting from 101, not 1).
 *
 * Why ≥ 101?  The ctx object carries small integers (0, 1, 2, numPlayers …).
 * Using card values that are clearly ≥ 100 means a JSON.stringify search for a
 * card value (e.g. "101") will never produce a false-positive match against ctx
 * fields, making the hidden-info test assertions unambiguous.
 */

import { defineGame } from '../../../src/engine/index.js';
import type { GameContext, GameDefinition, MaskedState } from '../../../src/engine/index.js';

// ── Domain types ─────────────────────────────────────────────────────────────

/** A card is just an integer value in [101, 116]. */
export type Card = number;

/** Pure domain state for the hidden-card game (the engine's `G`). */
export interface CardGameState {
  /** Remaining draw pile (top = index 0). Cards are values >= 101. */
  readonly deck: readonly Card[];
  /**
   * Per-player hands. `hands[i]` is the set of card values held by player i.
   * Only the owning player should see the actual values; opponents see only
   * the count — enforced by viewFor below.
   */
  readonly hands: readonly (readonly Card[])[];
}

/**
 * The per-player view returned by viewFor.
 *
 * The caller's own cards are fully revealed. For each opponent, only the
 * number of cards they hold is exposed — the VALUES are hidden.
 *
 * This is the typical "hand game" information model (e.g. Uno, Hanabi, poker
 * from the dealer's view before showdown).
 */
export interface CardGameView {
  /** The calling player's own hand (full card values). */
  readonly ownHand: readonly Card[];
  /**
   * For each player index i != caller: the count of cards in i's hand.
   * Indexed by player id (same length as total player count; own slot is 0).
   */
  readonly opponentHandSizes: readonly number[];
}

// ── Deck & setup ─────────────────────────────────────────────────────────────

/**
 * Build a deterministic deck of 16 cards: values 101..116.
 * The deck is intentionally small so the game ends quickly in tests.
 */
function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let i = 101; i <= 116; i++) {
    deck.push(i);
  }
  return deck;
}

// ── Moves ─────────────────────────────────────────────────────────────────────

/**
 * `draw` — the current player takes the top card of the deck into their hand.
 *
 * PURE: returns a new state with the deck minus its top card, and a new hand
 * for the acting player with the drawn card appended. Throws if the deck is
 * empty (signals illegal move to the engine).
 */
function draw(state: CardGameState, ctx: GameContext): CardGameState {
  if (state.deck.length === 0) {
    throw new Error('draw: deck is empty');
  }
  const [drawnCard, ...remainingDeck] = state.deck;
  const newHands = state.hands.map((hand, i) =>
    i === ctx.currentPlayer ? [...hand, drawnCard!] : [...hand],
  );
  return { deck: remainingDeck, hands: newHands };
}

/**
 * `discard` — the current player removes the card at index `payload` from
 * their hand.
 *
 * `payload` is the index into the acting player's hand array (not a card
 * value). Throws if the index is out of range.
 */
function discard(state: CardGameState, ctx: GameContext, payload?: unknown): CardGameState {
  const idx = payload as number;
  const hand = state.hands[ctx.currentPlayer];
  if (!hand || typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= hand.length) {
    throw new Error(`discard: invalid hand index ${String(idx)}`);
  }
  const newHand = hand.filter((_, i) => i !== idx);
  const newHands = state.hands.map((h, i) =>
    i === ctx.currentPlayer ? newHand : [...h],
  );
  return { deck: [...state.deck], hands: newHands };
}

// ── Victory ───────────────────────────────────────────────────────────────────

/**
 * The game is over when the deck is empty. The player holding the most cards
 * wins (their 0-based player index is returned). Ties go to the lower player
 * index. Returns null while the deck still has cards.
 */
function victory(state: CardGameState): number | null {
  if (state.deck.length > 0) return null;
  let best = -1;
  let winner = 0;
  for (let i = 0; i < state.hands.length; i++) {
    const count = state.hands[i]!.length;
    if (count > best) {
      best = count;
      winner = i;
    }
  }
  return winner;
}

// ── viewFor — the hidden-info hook ────────────────────────────────────────────

/**
 * Return a fresh view object for `playerId`: own hand fully exposed, opponents'
 * hands reduced to their sizes.
 *
 * @security
 *   - Returns a FRESH object; no reference into match.G is exposed.
 *   - opponentHandSizes carries only counts — card VALUES of opponents are
 *     withheld. Any code path that placed actual opponent card values here
 *     would be caught by the hidden-info e2e assertions in e2e-engine.test.ts.
 */
function viewFor(
  match: { G: CardGameState; ctx: GameContext },
  playerId: number,
): CardGameView {
  const { G } = match;
  const ownHand = [...G.hands[playerId]!]; // fresh copy, own cards fully visible
  const opponentHandSizes = G.hands.map((hand, i) =>
    i === playerId ? 0 : hand.length,
  );
  return { ownHand, opponentHandSizes };
}

// ── Game definition factory ───────────────────────────────────────────────────

/**
 * Build the hidden-card game definition.
 *
 * Each player starts with 2 cards dealt from the top of the deck. Each turn
 * the current player may draw or discard; the game ends when the deck empties.
 *
 * `numPlayers` defaults to 2 (the minimum; max is 4).
 */
export function hiddenCardGame(): GameDefinition<CardGameState> {
  return defineGame<CardGameState>({
    name: 'hidden-card-game',
    setup: (ctx: GameContext): CardGameState => {
      const deck = buildDeck();
      // Deal 2 cards to each player from the top of the deck.
      const hands: Card[][] = Array.from({ length: ctx.numPlayers }, () => []);
      for (let round = 0; round < 2; round++) {
        for (let p = 0; p < ctx.numPlayers; p++) {
          const card = deck.shift()!;
          hands[p]!.push(card);
        }
      }
      return { deck, hands };
    },
    moves: { draw, discard },
    turn: { minPlayers: 2, maxPlayers: 4, order: 'sequential' },
    victory,
    viewFor,
  });
}

/**
 * Type alias for the MaskedState produced by filterView on this game, so tests
 * can import it without needing to re-state the generic parameter.
 */
export type CardGameMaskedState = MaskedState<CardGameView>;
