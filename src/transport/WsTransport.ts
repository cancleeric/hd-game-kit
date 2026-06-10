import type { ITransport, ConnectionStatus } from './ITransport.js';

const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 8000;

/**
 * WsTransport — WebSocket implementation of ITransport with exponential
 * backoff reconnection.
 *
 * Game-specific reconnect identity (roomId / playerToken) must be set via
 * setReconnectIdentity() before the first connect(); the transport will
 * automatically send a reconnect message on re-open when both values are set.
 */
export class WsTransport<TOut, TIn> implements ITransport<TOut, TIn> {
  private socket: WebSocket | null = null;
  private url: string | null = null;
  private shouldReconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Opaque reconnect identity supplied by the caller. */
  private reconnectRoomId: string | null = null;
  private reconnectToken: string | null = null;

  private readonly messageListeners = new Set<(message: TIn) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  /**
   * Set game-level reconnect credentials.  When both are non-null the
   * transport will automatically send
   *   { type: 'reconnect', roomId, playerToken }
   * immediately after the WebSocket re-opens.
   */
  setReconnectIdentity(roomId: string | null, playerToken: string | null): void {
    this.reconnectRoomId = roomId;
    this.reconnectToken = playerToken;
  }

  connect(url: string): void {
    this.url = url;
    this.shouldReconnect = true;

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.emitStatus('connecting');
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.emitStatus('connected');

      if (this.reconnectRoomId && this.reconnectToken) {
        // Send the generic reconnect message; server must handle type='reconnect'.
        this.sendRaw({
          type: 'reconnect',
          roomId: this.reconnectRoomId,
          playerToken: this.reconnectToken,
        } as unknown as TOut);
      }
    };

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as TIn;
        this.emitMessage(parsed);
      } catch {
        // Emit a typed error-like object so callers can react without crashing.
        this.emitMessage({ type: 'error', message: 'Invalid server message.' } as unknown as TIn);
      }
    };

    this.socket.onclose = () => {
      this.emitStatus('disconnected');
      this.socket = null;
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = () => {
      this.emitStatus('disconnected');
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.emitStatus('disconnected');
  }

  send(message: TOut): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  onMessage(listener: (message: TIn) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private sendRaw(message: TOut): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (!this.url) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.url) return;
      this.connect(this.url);
    }, delay);
  }

  private emitMessage(message: TIn): void {
    for (const listener of this.messageListeners) listener(message);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
