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
export class WsTransport {
    socket = null;
    url = null;
    shouldReconnect = false;
    reconnectAttempt = 0;
    reconnectTimer = null;
    /** Opaque reconnect identity supplied by the caller. */
    reconnectRoomId = null;
    reconnectToken = null;
    messageListeners = new Set();
    statusListeners = new Set();
    /**
     * Set game-level reconnect credentials.  When both are non-null the
     * transport will automatically send
     *   { type: 'reconnect', roomId, playerToken }
     * immediately after the WebSocket re-opens.
     */
    setReconnectIdentity(roomId, playerToken) {
        this.reconnectRoomId = roomId;
        this.reconnectToken = playerToken;
    }
    connect(url) {
        this.url = url;
        this.shouldReconnect = true;
        if (this.socket &&
            (this.socket.readyState === WebSocket.OPEN ||
                this.socket.readyState === WebSocket.CONNECTING)) {
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
                });
            }
        };
        this.socket.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                this.emitMessage(parsed);
            }
            catch {
                // Emit a typed error-like object so callers can react without crashing.
                this.emitMessage({ type: 'error', message: 'Invalid server message.' });
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
    disconnect() {
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
    send(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
            return;
        this.socket.send(JSON.stringify(message));
    }
    onMessage(listener) {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
    }
    onStatusChange(listener) {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }
    // ── private helpers ──────────────────────────────────────────────────────
    sendRaw(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
            return;
        this.socket.send(JSON.stringify(message));
    }
    scheduleReconnect() {
        if (!this.url)
            return;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            if (!this.url)
                return;
            this.connect(this.url);
        }, delay);
    }
    emitMessage(message) {
        for (const listener of this.messageListeners)
            listener(message);
    }
    emitStatus(status) {
        for (const listener of this.statusListeners)
            listener(status);
    }
}
//# sourceMappingURL=WsTransport.js.map