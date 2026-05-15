/**
 * DND Battle Map — Cloudflare Worker
 *
 * Replaces the original Express + Socket.IO backend.
 *
 * Routing:
 *   GET /iceservers           → returns STUN server config (no auth)
 *   GET /game/:gameId/ws      → WebSocket upgrade, routed to GameRoom Durable Object
 *
 * Durable Object binding required: GAME_ROOM
 *
 * Message protocol (all messages are JSON):
 *   Client → Worker:  { type, args: [...] }
 *   Worker → Client:  { type, args: [...] }
 *
 * This mirrors socket.io's emit(event, ...args) / on(event, ...args) pattern
 * so the frontend SocketShim can map directly.
 */

// ---------------------------------------------------------------------------
// deep-diff applyChanges — inlined so the worker has zero npm dependencies
// Mirrors the logic in backend/src/helpers/diff.ts
// ---------------------------------------------------------------------------
function applyChanges(target, changes) {
  for (const change of changes) {
    _applyChange(target, change);
  }
}

function _applyChange(target, change) {
  const { path, kind } = change;
  if (!path || path.length === 0) return;

  // Traverse to the parent of the target key, matching deep-diff's own logic
  let obj = target;
  for (let i = 0; i < path.length - 1; i++) {
    if (obj == null) return;
    // For E or A changes the original helper validates the path exists
    if ((kind === "E" || kind === "A") && obj[path[i]] === undefined) return;
    obj = obj[path[i]];
  }
  if (obj == null) return;

  const key = path[path.length - 1];

  switch (kind) {
    case "N":
      obj[key] = change.rhs;
      break;
    case "E":
      if (obj[key] !== undefined) obj[key] = change.rhs;
      break;
    case "D":
      delete obj[key];
      break;
    case "A":
      if (Array.isArray(obj[key])) {
        _applyArrayChange(obj[key], change.index, change.item);
      }
      break;
  }
}

function _applyArrayChange(arr, index, change) {
  switch (change.kind) {
    case "N":
    case "E":
      arr[index] = change.rhs;
      break;
    case "D":
      arr.splice(index, 1);
      break;
    case "A":
      _applyArrayChange(arr[index], change.index, change.item);
      break;
  }
}

// ---------------------------------------------------------------------------
// Password hashing — Web Crypto SHA-256 + random salt
// bcrypt is not available in Workers; SHA-256 is fine for a private game
// ---------------------------------------------------------------------------
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(password + salt));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// GameRoom — one Durable Object instance per game (keyed by gameId)
// ---------------------------------------------------------------------------
export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map of socketId → { ws, id, joined }
    this.sessions = new Map();
    this.nextId = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this._handleWebSocket(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  // ── WebSocket upgrade ───────────────────────────────────────────────────
  async _handleWebSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    const socketId = `s${++this.nextId}`;

    this.sessions.set(socketId, { ws: server, id: socketId, joined: false });
    server.accept();

    server.addEventListener("message", async ({ data }) => {
      try {
        const msg = JSON.parse(data);
        await this._handleMessage(socketId, server, msg);
      } catch (e) {
        console.error("MSG_ERROR", e);
      }
    });

    const cleanup = async () => {
      const session = this.sessions.get(socketId);
      if (session?.joined) {
        // Notify peers
        this._broadcast(socketId, { type: "player_left", args: [socketId] });
        // Remove player state and push updated party state
        const gameData = (await this.state.storage.get("gameData")) ?? {};
        if (gameData.playerStates?.[socketId]) {
          delete gameData.playerStates[socketId];
          await this.state.storage.put("gameData", gameData);
          this._broadcastAll({
            type: "party_state",
            args: [this._partyState(gameData)],
          });
        }
      }
      this.sessions.delete(socketId);
    };

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Message dispatch ────────────────────────────────────────────────────
  async _handleMessage(socketId, ws, msg) {
    const { type, args = [] } = msg;

    switch (type) {
      case "join_game": {
        const [gameId, password] = args;
        await this._joinGame(socketId, ws, gameId, password);
        break;
      }

      case "signal": {
        // args[0] is a JSON string: { to, signal }
        const { to, signal } = JSON.parse(args[0]);
        const target = this.sessions.get(to);
        if (target?.joined) {
          this._send(target.ws, {
            type: "signal",
            args: [{ from: socketId, signal }],
          });
        }
        break;
      }

      case "map":
      case "map_state":
      case "manifest": {
        const [data] = args;
        const gameData = (await this.state.storage.get("gameData")) ?? {};
        gameData[type] = data;
        await this.state.storage.put("gameData", gameData);
        // Broadcast to everyone else (original used socket.broadcast)
        this._broadcast(socketId, { type, args: [data] });
        break;
      }

      case "map_state_update":
      case "manifest_update": {
        const [update] = args;
        // Stored under "map_state" / "manifest" (without "_update" suffix)
        const field = type === "map_state_update" ? "map_state" : "manifest";
        const gameData = (await this.state.storage.get("gameData")) ?? {};
        const current = gameData[field];

        // Only apply if the update targets the currently loaded map
        if (current && update.id === current.mapId) {
          applyChanges(current, update.changes);
          gameData[field] = current;
          await this.state.storage.put("gameData", gameData);
          this._broadcast(socketId, { type, args: [update] });
        }
        break;
      }

      case "player_state": {
        const [playerState] = args;
        const gameData = (await this.state.storage.get("gameData")) ?? {};
        gameData.playerStates ??= {};
        gameData.playerStates[socketId] = { ...playerState, sessionId: socketId };
        await this.state.storage.put("gameData", gameData);
        // Broadcast to everyone else (mirrors broadcastPlayerState)
        this._broadcast(socketId, {
          type: "party_state",
          args: [this._partyState(gameData)],
        });
        break;
      }

      case "player_pointer": {
        const [pointer] = args;
        this._broadcast(socketId, { type: "player_pointer", args: [pointer] });
        break;
      }

      default:
        break;
    }
  }

  // ── Join logic ──────────────────────────────────────────────────────────
  async _joinGame(socketId, ws, gameId, password) {
    let gameData = (await this.state.storage.get("gameData")) ?? {};

    if (!gameData.passwordHash) {
      // First player — create the game with this password
      const salt = crypto.randomUUID();
      gameData.passwordHash = await hashPassword(password ?? "", salt);
      gameData.passwordSalt = salt;
      gameData.playerStates = {};
      await this.state.storage.put("gameData", gameData);
    } else {
      // Verify password
      const hash = await hashPassword(password ?? "", gameData.passwordSalt);
      if (hash !== gameData.passwordHash) {
        this._send(ws, { type: "auth_error", args: [] });
        return;
      }
    }

    const session = this.sessions.get(socketId);
    if (session) session.joined = true;

    // Send initial state to the joining player
    this._send(ws, { type: "joined_game", args: [socketId] });
    this._send(ws, {
      type: "party_state",
      args: [this._partyState(gameData)],
    });
    this._send(ws, { type: "map_state", args: [gameData.map_state ?? null] });
    this._send(ws, { type: "map", args: [gameData.map ?? null] });
    this._send(ws, { type: "manifest", args: [gameData.manifest ?? null] });

    // Notify other joined players
    this._broadcast(socketId, { type: "player_joined", args: [socketId] });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  _partyState(gameData) {
    // Returns { [socketId]: playerState, ... }
    return Object.values(gameData.playerStates ?? {}).reduce((acc, ps) => {
      acc[ps.sessionId] = ps;
      return acc;
    }, {});
  }

  _send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (_) {
      // Connection already closed
    }
  }

  /** Broadcast to all joined sessions except excludeId */
  _broadcast(excludeId, msg) {
    const data = JSON.stringify(msg);
    for (const [id, session] of this.sessions) {
      if (id !== excludeId && session.joined) {
        try {
          session.ws.send(data);
        } catch (_) {
          this.sessions.delete(id);
        }
      }
    }
  }

  /** Broadcast to ALL joined sessions including sender */
  _broadcastAll(msg) {
    this._broadcast(null, msg);
    // Also send to null-excluded sessions (i.e. everyone)
    // Actually re-implement to include all:
    const data = JSON.stringify(msg);
    for (const [id, session] of this.sessions) {
      if (session.joined) {
        try {
          session.ws.send(data);
        } catch (_) {
          this.sessions.delete(id);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Default export — main Worker fetch handler
// ---------------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── /iceservers ─────────────────────────────────────────────────────
    if (url.pathname === "/iceservers") {
      const body = JSON.stringify({
        iceServers: [
          {
            urls: [
              "stun:stun.l.google.com:19302",
              "stun:stun1.l.google.com:19302",
            ],
          },
        ],
      });
      return new Response(body, {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // ── /game/:gameId/ws ─────────────────────────────────────────────────
    const m = url.pathname.match(/^\/game\/([^/]+)\/ws$/);
    if (m) {
      const gameId = m[1];
      const id = env.GAME_ROOM.idFromName(gameId);
      const stub = env.GAME_ROOM.get(id);

      // Rewrite pathname to /ws before forwarding to the DO
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
