# Cloudflare Deployment Setup

Two things to deploy:
1. **Cloudflare Worker** — the realtime backend (replaces the original Express/Socket.IO server)
2. **Cloudflare Pages** — the built React frontend (built locally, uploaded as a static site)

---

## Part 1 — Cloudflare Worker

### 1.1 Deploy the Worker

Run once from this repo (requires Node 25):

```bash
npx wrangler login
npx wrangler deploy
```

Your worker URL will be:  
`https://dnd-battle-map.<your-subdomain>.workers.dev`

> The `wrangler.toml` already configures the `GAME_ROOM` Durable Object binding and migration — no manual dashboard steps needed.

---

### 1.3 Verify the Worker

Open `https://dnd-battle-map.<your-subdomain>.workers.dev/iceservers` in your browser.  
You should see JSON like:
```json
{"iceServers":[{"urls":["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]}
```

---

## Part 2 — Frontend (local build → Cloudflare Pages static upload)

The frontend is built locally and uploaded as a pre-built static site.  
Cloudflare Pages does **not** build it — environment variables are baked in at build time via a `.env` file.

---

### 2.1 Set up the build environment

Use a Python virtualenv to keep Node isolated and easy to clean up:

```bash
# Navigate to the project folder
cd /path/to/OwlBearCF

# Install nvm (Node version manager) if you don't have it
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh

# Install and use the project's Node version
nvm install
nvm use

# Install dependencies
npm install --legacy-peer-deps
```

To clean up later: `nvm uninstall 25` removes the Node 25 install entirely.

---

### 2.2 Configure the environment variable

Create a `.env` file in the repo root (already in `.gitignore` — never committed):

```bash
cp .env.example .env
```

Edit `.env` and set your worker URL:

```
VITE_BROKER_URL=https://dnd-battle-map.<your-subdomain>.workers.dev
```

> Use `https://` — the frontend converts it to `wss://` automatically for WebSocket connections.

---

### 2.3 Build

```bash
npm run build
```

The output goes to the `build/` folder.

---

### 2.4 Upload to Cloudflare Pages

1. Go to **Workers & Pages → Create → Pages → Upload assets**
2. Name the project (e.g. `dnd-battle-map`)
3. Drag and drop the entire **`build/`** folder
4. Click **Deploy**

Your app will be live at:  
`https://dnd-battle-map.pages.dev` (or a custom domain if you configure one)

> To redeploy after changes: run `npm run build` again and re-upload the `build/` folder via **Deployments → Upload assets** in the Pages dashboard.

---

## How it works

```
Browser A  ──WS──▶  Cloudflare Worker  ──broadcast──▶  Browser B
                     (Durable Object)
                     (persistent state)
                           │
                    WebRTC signaling
                           │
Browser A  ──P2P──────────────────────────────────────  Browser B
           (map images, tokens transferred directly)
```

- **WebSocket** (via the Worker) handles game events: map state, tokens, fog, drawings, player cursors, and WebRTC signaling.
- **WebRTC P2P** (between browsers) transfers large assets like map images and token art — the worker only relays the signaling handshake.
- **Durable Object storage** persists map/token state so players who reconnect or join late see the current state.

---

## Creating and joining a game

1. Open the app and click **Start Game** (or whatever the UI calls it)
2. Enter a **Game ID** (any string, e.g. `session-5`) and a **Password**
3. The first player to use a Game ID sets its password — subsequent players must use the same one
4. Share the Game ID + Password with your friends; they join via **Join Game**

> Game state persists in the Durable Object as long as the game room hasn't been evicted (typically kept for 30 days of inactivity).

---

## Local development

```bash
nvm use
VITE_BROKER_URL=https://dnd-battle-map.<your-subdomain>.workers.dev npm start
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "auth_error" on join | Wrong password for an existing game ID — try a different Game ID |
| Stuck on "joining…" | `VITE_BROKER_URL` not set, or worker not deployed yet |
| Map images don't appear for others | WebRTC P2P blocked (corporate network/VPN) — WebRTC requires peer connectivity |
| Worker returns 500 | Durable Object binding `GAME_ROOM` not saved — re-check Part 1 |
| Build fails | Make sure you're on Node 25 (`nvm use`) |
