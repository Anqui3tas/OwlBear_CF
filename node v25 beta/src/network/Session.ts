/**
 * Session — manages the connection to the Cloudflare Worker backend.
 *
 * Replaces the original socket.io-based Session with a native WebSocket
 * implementation via SocketShim.  All other network code (Connection.ts,
 * NetworkedMapAndTokens, useNetworkedState, etc.) is unchanged — they
 * interact with `session.socket` using the same .emit() / .on() API that
 * socket.io exposed, which SocketShim replicates.
 *
 * Connection flow (differs slightly from the original):
 *   1. connect()    — fetches ICE servers, emits "ready" (no WS yet)
 *   2. joinGame()   — opens WebSocket to /game/:gameId/ws, sends join_game
 *   3. SocketShim   — handles reconnect automatically; re-calls joinGame
 */

import { EventEmitter } from "events";

import Connection, { DataProgressEvent } from "./Connection";
import SocketShim from "./SocketShim";

import { omit } from "../helpers/shared";
import { SignalData } from "simple-peer";
import { appVersion, brokerUrl, maintenanceMode } from "../env";

export type SessionPeer = {
  id: string;
  connection: Connection;
  initiator: boolean;
  ready: boolean;
};

export type PeerData = any;
export type PeerReply = (id: string, data: PeerData, chunkId?: string) => void;

class Session extends EventEmitter {
  /**
   * The active WebSocket shim.  Typed as `any` so the rest of the codebase
   * that imported the socket.io Socket type continues to compile without
   * changes — the runtime interface is identical.
   */
  socket: SocketShim | undefined;

  peers: Record<string, SessionPeer>;

  get id() {
    return this.socket?.id;
  }

  _iceServers: RTCIceServer[] = [];
  _gameId: string = "";
  _password: string = "";

  constructor() {
    super();
    this.peers = {};
    window.addEventListener("beforeunload", this._handleUnload.bind(this));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Called once on app startup.  Fetches ICE servers from the worker and
   * sets status to "ready".  The actual WebSocket is opened in joinGame().
   */
  async connect() {
    try {
      if (!brokerUrl || maintenanceMode) {
        this.emit("status", "offline");
        return;
      }

      // Fetch STUN/TURN config from the worker's /iceservers endpoint
      try {
        const response = await fetch(`${brokerUrl}/iceservers`);
        if (response.ok) {
          const data = await response.json();
          this._iceServers = data.iceServers;
        }
      } catch {
        // Fall back to Google STUN if worker isn't reachable yet
        this._iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
      }

      this.emit("status", "ready");
    } catch {
      this.emit("status", "offline");
    }
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = undefined;
  }

  // ── Game join ─────────────────────────────────────────────────────────

  async joinGame(gameId: string, password: string) {
    if (typeof gameId !== "string" || typeof password !== "string") {
      console.error("joinGame: invalid gameId or password", gameId, password);
      return;
    }

    this._gameId = gameId;
    this._password = password;

    // Close any existing connection before opening a new one
    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
    }

    // Convert http(s) → ws(s) for the WebSocket URL
    const wsBase = brokerUrl.replace(/^http/, "ws").replace(/\/$/, "");
    const wsUrl = `${wsBase}/game/${encodeURIComponent(gameId)}/ws`;

    const shim = new SocketShim(wsUrl);
    this.socket = shim;

    // Register all incoming-event handlers before connecting so nothing
    // is missed between connect() resolving and the first message arriving.
    shim.on("player_joined", this._handlePlayerJoined.bind(this));
    shim.on("player_left", this._handlePlayerLeft.bind(this));
    shim.on("joined_game", this._handleJoinedGame.bind(this));
    shim.on("signal", this._handleSignal.bind(this));
    shim.on("auth_error", this._handleAuthError.bind(this));
    shim.on("game_expired", this._handleGameExpired.bind(this));
    shim.io.on("reconnect", this._handleSocketReconnect.bind(this));

    this.emit("status", "joining");

    try {
      await shim.connect();
    } catch {
      this.emit("status", "offline");
      return;
    }

    // Send join_game immediately after the connection opens.
    // The worker will respond with joined_game + initial state.
    shim.emit(
      "join_game",
      gameId,
      password,
      appVersion
    );
  }

  // ── P2P helpers (unchanged from original) ────────────────────────────

  sendTo(sessionId: string, eventId: string, data: PeerData, chunkId?: string) {
    if (!(sessionId in this.peers)) {
      if (!this._addPeer(sessionId, true)) return;
    }
    if (!this.peers[sessionId].ready) {
      this.peers[sessionId].connection.once("connect", () => {
        this.peers[sessionId].connection.sendObject({ id: eventId, data }, chunkId);
      });
    } else {
      this.peers[sessionId].connection.sendObject({ id: eventId, data }, chunkId);
    }
  }

  startStreamTo(sessionId: string, track: MediaStreamTrack, stream: MediaStream) {
    if (!(sessionId in this.peers)) {
      if (!this._addPeer(sessionId, true)) return;
    }
    if (!this.peers[sessionId].ready) {
      this.peers[sessionId].connection.once("connect", () => {
        this.peers[sessionId].connection.addTrack(track, stream);
      });
    } else {
      this.peers[sessionId].connection.addTrack(track, stream);
    }
  }

  endStreamTo(sessionId: string, track: MediaStreamTrack, stream: MediaStream) {
    if (sessionId in this.peers) {
      this.peers[sessionId].connection.removeTrack(track, stream);
    }
  }

  // ── Peer management (unchanged from original) ─────────────────────────

  _addPeer(id: string, initiator: boolean): boolean {
    try {
      const connection = new Connection({
        initiator,
        trickle: true,
        config: { iceServers: this._iceServers },
      });
      connection.setMaxListeners && connection.setMaxListeners(100);

      const peer = { id, connection, initiator, ready: false };

      const reply: PeerReply = (id, data, chunkId) => {
        peer.connection.sendObject({ id, data }, chunkId);
      };

      const handleSignal = (signal: SignalData) => {
        // Signal data is sent as a JSON string to match the original backend contract
        this.socket?.emit("signal", JSON.stringify({ to: peer.id, signal }));
      };

      const handleConnect = () => {
        if (peer.id in this.peers) this.peers[peer.id].ready = true;
        this.emit("peerConnect", { peer, reply } as PeerConnectEvent);
      };

      const handleDataComplete = (data: any) => {
        this.emit("peerData", {
          peer,
          id: data.id,
          data: data.data,
          reply,
        } as PeerDataEvent);
      };

      const handleDataProgress = ({ id, count, total }: DataProgressEvent) => {
        this.emit("peerDataProgress", {
          peer,
          id,
          count,
          total,
          reply,
        } as PeerDataProgressEvent);
      };

      const handleTrack = (track: MediaStreamTrack, stream: MediaStream) => {
        this.emit("peerTrackAdded", { peer, track, stream } as PeerTrackAddedEvent);
        track.addEventListener("mute", () => {
          this.emit("peerTrackRemoved", { peer, track, stream } as PeerTrackRemovedEvent);
        });
      };

      const handleClose = () => {
        this.emit("peerDisconnect", { peer } as PeerDisconnectEvent);
        if (peer.id in this.peers) {
          peer.connection.destroy();
          this.peers = omit(this.peers, [peer.id]);
        }
      };

      const handleError = (error: PeerError) => {
        this.emit("peerError", { peer, error } as PeerErrorEvent);
        if (peer.id in this.peers) {
          peer.connection.destroy();
          this.peers = omit(this.peers, [peer.id]);
        }
      };

      peer.connection.on("signal", handleSignal.bind(this));
      peer.connection.on("connect", handleConnect.bind(this));
      peer.connection.on("dataComplete", handleDataComplete.bind(this));
      peer.connection.on("dataProgress", handleDataProgress.bind(this));
      peer.connection.on("track", handleTrack.bind(this));
      peer.connection.on("close", handleClose.bind(this));
      peer.connection.on("error", handleError.bind(this));

      this.peers[id] = peer;
      return true;
    } catch (error: any) {
      this.emit("peerError", { error });
      for (const peer of Object.values(this.peers)) {
        peer.connection?.destroy();
      }
      return false;
    }
  }

  // ── Incoming event handlers ───────────────────────────────────────────

  _handleJoinedGame() {
    this.emit("status", "joined");
  }

  _handleGameExpired() {
    this.emit("gameExpired");
  }

  _handlePlayerJoined(id: string) {
    this.emit("playerJoined", id);
  }

  _handlePlayerLeft(id: string) {
    this.emit("playerLeft", id);
    if (id in this.peers) {
      this.peers[id].connection.destroy();
      delete this.peers[id];
    }
  }

  _handleSignal(data: { from: string; signal: SignalData }) {
    const { from, signal } = data;
    if (!(from in this.peers)) {
      if (!this._addPeer(from, false)) return;
    }
    this.peers[from].connection.signal(signal);
  }

  _handleAuthError() {
    this.emit("status", "auth");
  }

  _handleUnload() {
    for (const peer of Object.values(this.peers)) {
      peer.connection?.destroy();
    }
  }

  _handleSocketReconnect() {
    // socket.sendBuffer = [] is a no-op on SocketShim (field exists but unused)
    if (this.socket) this.socket.sendBuffer = [];
    if (this._gameId) {
      this.joinGame(this._gameId, this._password);
    }
  }
}

// ── Type exports (unchanged from original) ───────────────────────────────

export type PeerConnectEvent = { peer: SessionPeer; reply: PeerReply };
export type PeerConnectEventHandler = (event: PeerConnectEvent) => void;

export type PeerDataEvent = {
  peer: SessionPeer;
  id: string;
  data: PeerData;
  reply: PeerReply;
};
export type PeerDataEventHandler = (event: PeerDataEvent) => void;

export type PeerDataProgressEvent = {
  peer: SessionPeer;
  id: string;
  count: number;
  total: number;
  reply: PeerReply;
};
export type PeerDataProgressEventHandler = (event: PeerDataProgressEvent) => void;

export type PeerTrackAddedEvent = {
  peer: SessionPeer;
  track: MediaStreamTrack;
  stream: MediaStream;
};
export type PeerTrackAddedEventHandler = (event: PeerTrackAddedEvent) => void;

export type PeerTrackRemovedEvent = {
  peer: SessionPeer;
  track: MediaStreamTrack;
  stream: MediaStream;
};
export type PeerTrackRemovedEventHandler = (event: PeerTrackRemovedEvent) => void;

export type PeerDisconnectEvent = { peer: SessionPeer };
export type PeerDisconnectEventHandler = (event: PeerDisconnectEvent) => void;

export type PeerError = Error & { code: string };
export type PeerErrorEvent = { peer: SessionPeer; error: PeerError };
export type PeerErrorEventHandler = (event: PeerErrorEvent) => void;

export type SessionStatus =
  | "ready"
  | "joining"
  | "joined"
  | "offline"
  | "reconnecting"
  | "auth"
  | "needs_update";
export type SessionStatusHandler = (status: SessionStatus) => void;

export type PlayerJoinedHandler = (id: string) => void;
export type PlayerLeftHandler = (id: string) => void;
export type GameExpiredHandler = () => void;

declare interface Session {
  on(event: "peerConnect", listener: PeerConnectEventHandler): this;
  on(event: "peerData", listener: PeerDataEventHandler): this;
  on(event: "peerDataProgress", listener: PeerDataProgressEventHandler): this;
  on(event: "peerTrackAdded", listener: PeerTrackAddedEventHandler): this;
  on(event: "peerTrackRemoved", listener: PeerTrackRemovedEventHandler): this;
  on(event: "peerDisconnect", listener: PeerDisconnectEventHandler): this;
  on(event: "peerError", listener: PeerErrorEventHandler): this;
  on(event: "status", listener: SessionStatusHandler): this;
  on(event: "playerJoined", listener: PlayerJoinedHandler): this;
  on(event: "playerLeft", listener: PlayerLeftHandler): this;
  on(event: "gameExpired", listener: GameExpiredHandler): this;
}

export default Session;
