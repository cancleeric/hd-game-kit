/**
 * ITransport — generic bidirectional message transport interface.
 *
 * TOut: messages sent by the local side (client→server)
 * TIn:  messages received from the remote side (server→client)
 */
export interface ITransport<TOut, TIn> {
  /** Open the connection to the given URL. */
  connect(url: string): void;

  /** Close the connection and stop any pending reconnect timers. */
  disconnect(): void;

  /**
   * Send a message to the remote side.
   * Silently drops the message if the connection is not open.
   */
  send(message: TOut): void;

  /**
   * Register a listener for incoming messages.
   * Returns an unsubscribe function.
   */
  onMessage(listener: (message: TIn) => void): () => void;

  /**
   * Register a listener for connection status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
