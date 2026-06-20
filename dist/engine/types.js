/**
 * @hd/game-kit/engine — core engine types.
 *
 * Deterministic, server-authoritative game engine in the boardgame.io shape
 * (企劃 §5): a game is a pure-function module of `state + moves`. This file
 * defines the contract types only — no runtime logic lives here.
 *
 * Engine purity contract:
 *   - A `MoveFn` MUST be pure: it returns a NEW state and MUST NOT mutate its
 *     inputs. The reducer relies on this for determinism.
 *
 * NOTE: PR-1 deliberately does NOT implement phases / turn advancement; those
 * fields are reserved for PR-2. Only the minimal "given state + move → new
 * state" closed loop is provided here.
 */
export {};
//# sourceMappingURL=types.js.map