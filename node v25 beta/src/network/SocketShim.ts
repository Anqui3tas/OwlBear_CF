/**
 * SocketShim — drop-in WebSocket replacement for socket.io-client.
 *
 * The original codebase called:
 *   session.socket.emit(event, ...args)   → send to server
 *   session.socket.on(event, handler)     → receive from server
 *   session.socket.io.on("reconnect", h)  → reconnect lifecycle
 *
 * This shim provides that same surface over a native WebSocket.
 *
 * Wire protocol (mirrors socket.io's conceptual model):
 *   Client → Server: JSON  { type: string, args: any[] }
 *   Server → Client: JSON  { type: string, args: any[] }
 */

type Handler = (...args: any[]) => void;

export class SocketShim {
  /** Assigned by the server on joined_game */
  id: string = "";

  /**
   * socket.io compat: Session.ts calls socket.io.on("reconnect", …)
   * to re-join the game after a reconnect.
   */
  io: { on: (event: string, handler: Handler) => void; off: (event: string, handler: Handler) => void };

  /**
   * socket.io compat: _handleSocketReconnect sets socket.sendBuffer = []
   * We expose the field so that assignment doesn't throw; it's a no-op here.
   */
  sendBuffer: any[] = [];
  get volatile(): this { return this; }

  private _ws: WebSocket | null = null;
  private readonly _url: string;
  private readonly _handlers = new Map<string, Handler[]>();
  private readonly _reconnectHandlers: Handler[] = [];
  private _shouldReconnect = true;

  constructor(url: string) {
    this._url = url;
    this.io = {
      on: (event: string, handler: Handler) => {
        if (event === "reconnect") {
          this._reconnectHandlers.push(handler);
        }
      },
      off: (event: string, handler: Handler) => {
        if (event === "reconnect") {
          const i = this._reconnectHandlers.indexOf(handler);
          if (i !== -1) this._reconnectHandlers.splice(i, 1);
        }
      },
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Open the WebSocket. Resolves when the connection is established. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this._url);
        this._ws = ws;

        const timeout = setTimeout(() => {
          reject(new Error("WebSocket connection timed out"));
        }, 10_000);

        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };

        ws.onmessage = (e: MessageEvent) => {
          this._dispatch(e.data as string);
        };

        ws.onclose = () => {
          this._ws = null;
          if (this._shouldReconnect) {
            this._scheduleReconnect();
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          // onclose fires after onerror; let it handle retry
          reject(new Error("WebSocket error"));
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  disconnect() {
    this._shouldReconnect = false;
    this._ws?.close();
    this._ws = null;
  }

  // ── Sending (client → server) ─────────────────────────────────────────

  /**
   * Send an event to the server.
   * Maps to socket.io's socket.emit(event, ...args).
   */
  emit(event: string, ...args: any[]): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this._ws.send(JSON.stringify({ type: event, args }));
  }

  // ── Receiving (server → client) ───────────────────────────────────────

  /**
   * Register a handler for an incoming server event.
   * Maps to socket.io's socket.on(event, handler).
   */
  on(event: string, handler: Handler): this {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }
    this._handlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler: Handler): this {
    const handlers = this._handlers.get(event);
    if (handlers) {
      this._handlers.set(event, handlers.filter((h) => h !== handler));
    }
    return this;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private _dispatch(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { type: string; args?: any[] };
      const args = msg.args ?? [];

      // Capture the socket id the server assigns us
      if (msg.type === "joined_game" && args[0]) {
        this.id = String(args[0]);
      }

      const handlers = this._handlers.get(msg.type);
      if (handlers) {
        for (const h of handlers) {
          h(...args);
        }
      }
    } catch (_) {
      // Ignore malformed messages
    }
  }

  private _scheduleReconnect(delayMs = 3_000): void {
    setTimeout(async () => {
      try {
        await this.connect();
        for (const h of this._reconnectHandlers) {
          h();
        }
      } catch (_) {
        // connect() failed; onclose will schedule another retry
      }
    }, delayMs);
  }
}

export default SocketShim;
