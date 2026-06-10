/**
 * server-subpath.test.ts
 *
 * Validates that:
 * 1. The server subpath (src/server/index.ts) exports RoomManager and roomSummary.
 * 2. The root index (src/index.ts) does NOT export RoomManager as a value
 *    (only type re-exports are allowed — confirmed by runtime typeof check).
 */

import { describe, it, expect } from 'vitest';

// Import from the server subpath source
import * as serverExports from '../src/server/index.js';

// Import from the root index source
import * as rootExports from '../src/index.js';

describe('@hd/game-kit/server subpath exports', () => {
  it('exports RoomManager as a constructor', () => {
    expect(typeof serverExports.RoomManager).toBe('function');
  });

  it('exports roomSummary as a function', () => {
    expect(typeof serverExports.roomSummary).toBe('function');
  });

  it('RoomManager can be instantiated from server subpath', () => {
    const mgr = new serverExports.RoomManager();
    expect(mgr.getRoomCount()).toBe(0);
  });

  it('roomSummary works when called via server subpath', () => {
    const mgr = new serverExports.RoomManager();
    const res = mgr.createRoom('TestPlayer');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const summary = serverExports.roomSummary({
      id: res.value.room.id,
      players: [],
      hostPlayerId: 1,
      gameStarted: false,
      gameState: null,
    });
    expect(summary.id).toBe(res.value.room.id);
  });
});

describe('@hd/game-kit root index (browser-safe)', () => {
  it('does NOT export RoomManager as a runtime value', () => {
    expect((rootExports as Record<string, unknown>)['RoomManager']).toBeUndefined();
  });

  it('does NOT export roomSummary as a runtime value', () => {
    expect((rootExports as Record<string, unknown>)['roomSummary']).toBeUndefined();
  });

  it('exports WsTransport as a constructor', () => {
    expect(typeof rootExports.WsTransport).toBe('function');
  });
});
