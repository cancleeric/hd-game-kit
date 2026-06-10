import type { ITransport, ConnectionStatus } from './ITransport.js';
/**
 * WsTransport — WebSocket implementation of ITransport with exponential
 * backoff reconnection.
 *
 * Game-specific reconnect identity (roomId / playerToken) must be set via
 * setReconnectIdentity() before the first connect(); the transport will
 * automatically send a reconnect message on re-open when both values are set.
 */
export declare class WsTransport<TOut, TIn> implements ITransport<TOut, TIn> {
    private socket;
    private url;
    private shouldReconnect;
    private reconnectAttempt;
    private reconnectTimer;
    /** Opaque reconnect identity supplied by the caller. */
    private reconnectRoomId;
    private reconnectToken;
    private readonly messageListeners;
    private readonly statusListeners;
    /**
     * Set game-level reconnect credentials.  When both are non-null the
     * transport will automatically send
     *   { type: 'reconnect', roomId, playerToken }
     * immediately after the WebSocket re-opens.
     */
    setReconnectIdentity(roomId: string | null, playerToken: string | null): void;
    connect(url: string): void;
    disconnect(): void;
    send(message: TOut): void;
    onMessage(listener: (message: TIn) => void): () => void;
    onStatusChange(listener: (status: ConnectionStatus) => void): () => void;
    private sendRaw;
    private scheduleReconnect;
    private emitMessage;
    private emitStatus;
}
//# sourceMappingURL=WsTransport.d.ts.map