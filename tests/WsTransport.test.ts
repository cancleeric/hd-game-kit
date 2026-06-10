import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsTransport } from '../src/transport/WsTransport.js';

// ── Mock WebSocket ────────────────────────────────────────────────────────────

type WsReadyState = 0 | 1 | 2 | 3;

class MockWebSocket {
  static readonly CONNECTING: WsReadyState = 0;
  static readonly OPEN: WsReadyState = 1;
  static readonly CLOSING: WsReadyState = 2;
  static readonly CLOSED: WsReadyState = 3;

  static lastInstance: MockWebSocket | null = null;
  static instances: MockWebSocket[] = [];

  readyState: WsReadyState = MockWebSocket.CONNECTING;
  url: string;
  sentMessages: string[] = [];

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test helper: simulate server accepting the connection. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: simulate server sending a message. */
  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Test helper: simulate network drop. */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket.lastInstance = null;
  MockWebSocket.instances = [];
  // Inject mock into global scope
  (globalThis as unknown as Record<string, unknown>)['WebSocket'] = MockWebSocket;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

type Msg = { type: string; [k: string]: unknown };

describe('WsTransport', () => {
  it('emits "connecting" then "connected" on successful open', () => {
    const transport = new WsTransport<Msg, Msg>();
    const statuses: string[] = [];
    transport.onStatusChange((s) => statuses.push(s));

    transport.connect('ws://test');
    expect(statuses).toEqual(['connecting']);

    MockWebSocket.lastInstance!.simulateOpen();
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('delivers incoming messages to onMessage listeners', () => {
    const transport = new WsTransport<Msg, Msg>();
    const received: Msg[] = [];
    transport.onMessage((m) => received.push(m));

    transport.connect('ws://test');
    MockWebSocket.lastInstance!.simulateOpen();
    MockWebSocket.lastInstance!.simulateMessage({ type: 'room_update', room: {} });

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('room_update');
  });

  it('sends message when socket is open', () => {
    const transport = new WsTransport<Msg, Msg>();
    transport.connect('ws://test');
    const ws = MockWebSocket.lastInstance!;
    ws.simulateOpen();

    transport.send({ type: 'set_ready', ready: true });

    expect(ws.sentMessages).toHaveLength(1);
    expect(JSON.parse(ws.sentMessages[0]!)).toMatchObject({ type: 'set_ready', ready: true });
  });

  it('drops send when socket is not open', () => {
    const transport = new WsTransport<Msg, Msg>();
    // Not connected yet — send should be a no-op.
    transport.send({ type: 'create_room', playerName: 'Ghost' });

    expect(MockWebSocket.lastInstance).toBeNull();
  });

  it('schedules exponential backoff reconnect on close', () => {
    const transport = new WsTransport<Msg, Msg>();
    transport.connect('ws://test');
    const ws1 = MockWebSocket.lastInstance!;
    ws1.simulateOpen(); // reconnectAttempt reset to 0

    // Drop; attempt=0 → delay = 1000 ms * 2^0 = 1000 ms; attempt becomes 1
    ws1.simulateClose();
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1); // not yet

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2); // ws2 created

    const ws2 = MockWebSocket.lastInstance!;
    // ws2 opens → reconnectAttempt reset to 0
    ws2.simulateOpen();

    // Drop again; attempt=0 → delay = 1000 ms
    ws2.simulateClose();

    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3); // ws3 created
  });

  it('caps backoff at MAX_RECONNECT_DELAY_MS (8000 ms)', () => {
    const transport = new WsTransport<Msg, Msg>();
    transport.connect('ws://test');

    // Exhaust through several attempts to reach cap
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateClose();
      // advance past 8000 to ensure the timer fires regardless of delay
      vi.advanceTimersByTime(8001);
    }

    // All reconnects should have fired (≥6 extra instances)
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(6);
  });

  it('stops reconnecting after disconnect()', () => {
    const transport = new WsTransport<Msg, Msg>();
    transport.connect('ws://test');
    const ws = MockWebSocket.lastInstance!;
    ws.simulateOpen();

    transport.disconnect();

    // Even after waiting 10 s no new WebSocket should be created
    vi.advanceTimersByTime(10_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('sends reconnect message on re-open when identity is set', () => {
    const transport = new WsTransport<Msg, Msg>();
    transport.setReconnectIdentity('ROOM01', 'abc123token');
    transport.connect('ws://test');

    const ws = MockWebSocket.lastInstance!;
    ws.simulateOpen();

    expect(ws.sentMessages).toHaveLength(1);
    const sent = JSON.parse(ws.sentMessages[0]!) as Msg;
    expect(sent.type).toBe('reconnect');
    expect(sent['roomId']).toBe('ROOM01');
    expect(sent['playerToken']).toBe('abc123token');
  });

  it('unsubscribe from onMessage works', () => {
    const transport = new WsTransport<Msg, Msg>();
    const received: Msg[] = [];
    const unsub = transport.onMessage((m) => received.push(m));

    transport.connect('ws://test');
    MockWebSocket.lastInstance!.simulateOpen();
    MockWebSocket.lastInstance!.simulateMessage({ type: 'ping' });
    expect(received).toHaveLength(1);

    unsub();
    MockWebSocket.lastInstance!.simulateMessage({ type: 'ping' });
    expect(received).toHaveLength(1); // no new message
  });
});
