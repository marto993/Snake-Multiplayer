# Snake Multiplayer

Real-time multiplayer Snake. Vanilla JS + Socket.IO + SQLite. **No build step, no bundler, no automated tests.** 3 production deps. Deployed on Fly.io.

## Commands

```bash
npm install
npm run dev    # nodemon, port 3000
npm start      # production
fly deploy     # deploy to Fly.io
```

## Files

| File | Lines | Owns |
|------|-------|------|
| `index.js` | ~1900 | Server: Express, Socket.IO, SQLite, game loop, rooms, projectiles, consumables, per-frame game events |
| `public/SnakeGame.js` | ~2000 | Client glue: socket handlers, game/UI state, wiring events into the modules below. No drawing code. |
| `public/snakeClass.js` | ~350 | Snake entity — runs on **both** client and server |
| `public/index.html` | ~360 | Scene markup only (no inline CSS) |
| `public/css/theme.css` | ~2600 | Bioluminescent theme, `--bio-*` design tokens |
| `public/js/fx/particles.js` | ~450 | `window.Particles`: pooled particle systems |
| `public/js/render/arena.js` | ~3100 | `window.Arena`: game canvas renderer (DPR, glow sprites, effects, idle attract mode, last-10s counter) |
| `public/js/ui/backdrop.js` | ~1150 | `window.Backdrop`: full-screen ambient canvas behind every scene, moods |
| `public/js/ui/scenes.js` | ~2300 | `window.Scenes` / `Overlays` / `Toasts` / `HUD`: scene transitions, intro, countdown, round end, final, toasts, DOM HUD |
| `docs/VISUAL_SPEC.md` | ~1400 | Visual spec: palette, typography, motion, scene map, effects catalog. Read it before touching visuals. |

Script load order matters (index.html): socket.io → snakeClass → particles → arena → backdrop → scenes → SnakeGame. Each module is an IIFE that exposes its API on `window`; no ES modules.

`game_stats.db` is auto-created. Schema lives in `index.js` near the top.

## Architecture

**Server-authoritative.** Server runs `gameLogicLoop()` at `config.gameSpeed` (default 83ms ≈ 12 Hz), validates everything, broadcasts `gameLogicFrame`. Client predicts locally for input responsiveness, then reconciles to server state.

**Interpolation.** Client renders at ~60 FPS by lerping `renderSegments` toward `targetSegments` every animation frame. `interpolationSpeed` is auto-derived from `gameSpeed`.

**Room state.** All state lives in `rooms` Map keyed by 6-char room code. Each room owns its own players, gameboard, foods, consumables, projectiles, timers, spectators. No global player state — players exist only inside a room.

**Round flow.** `startGame` → 3s countdown → `gameLogicLoop` interval + 60s round timer → `endRound` → repeat 3× → `endGame` → room deleted after 30s.

## Non-obvious gotchas

- **Timer cleanup is mandatory.** `deleteRoom()` must `clearInterval` the game loop, round timer, **and** every entry in `consumableTimers`. Missed timers = memory leak + ghost game ticks.
- **DB path differs by env.** Dev: `./game_stats.db`. Prod (Fly): `/app/data/game_stats.db` (persistent volume `game_stats_volume`). Logic at `index.js:14`.
- **Player IDs are compound:** `${username}_${Date.now()}`. Don't query players by `name`.
- **"Configurable" values that aren't:** `maxRounds=3`, `roundTime=60`, `canvasWidth/Height=600`, `attacksEnabled=true` are hardcoded despite passing through `validateRoomConfig`. Changing them needs code edits, not just UI.
- **Portal wraparound breaks interpolation.** When a snake teleports edge-to-edge, naive lerp animates across the whole canvas. `updateRenderPosition()` detects jumps > canvas/2 and snaps instantly — preserve this when touching rendering. `arena.js` also cuts the continuous body path wherever consecutive segments are > canvas/2 apart.
- **Game events for effects.** `gameLogicFrame` carries `foodEvents`, `hitEvents`, `blockEvents`, `projectileEvents`, `expiredProjectiles` (always present, possibly empty), plus coordinates on `portals` and `consumableEvents`. Shots fired between ticks are buffered in `room.pendingProjectileEvents`. `SnakeGame.js` forwards each one to an `Arena.on*` hook.
- **Rendering performance.** No `shadowBlur` in per-frame drawing: glow comes from cached offscreen sprites + `'lighter'` compositing. `arena.js` drops quality automatically under load. Don't rebuild DOM per frame; `HUD.update` diffs by player id.
- **Round transition timer.** `endRound` stores the 3s next-round timeout in `room.gameState.nextRoundTimeoutId`. It must be cleared in `deleteRoom`, `endGame` and `abortMatch` (too few players), or a deleted room keeps ticking.
- **Spectator vs player on join.** `joinRoom` branches on `room.gameState.playing`: in-progress room → spectator (added to `room.spectators` Map), lobby → player. Both paths must be handled when adding join logic.
- **Host migration on disconnect.** If the disconnecting socket is `room.host`, promote `room.players[0]` and emit `newHost`. If no players remain, delete the room.
- **Shared snake class.** `snakeClass.js` is loaded by both server (`require`) and client (`<script>`). Don't add browser-only or Node-only APIs to it.
- **Move queue caps at 3.** Buffered inputs beyond that are dropped. 180° turns are rejected (opposite-direction check).
- **Attack cost.** Firing a projectile pops one tail segment. Snakes with `< 2` segments can't attack.

## Testing

No automated tests. Validate changes by running `npm run dev` and opening multiple browser windows (use incognito for distinct sessions). Inspect DB with `sqlite3 game_stats.db`.

`ROUND_TIME=10 npm run dev` shortens rounds for testing (positive integers only; default 60). Headless browser checks work with `puppeteer-core` + `/snap/bin/chromium` (the snap can't write to host `/tmp`, so use a dir under `~`).

## Deployment

Fly.io, region `gru` (São Paulo), auto-stop when idle, persistent volume for SQLite. Config in `fly.toml` and `Dockerfile`. App URL: `snake-multiplayer-2024.fly.dev`.

```bash
fly logs                                          # tail prod logs
fly ssh console                                   # shell into machine
fly ssh sftp get /app/data/game_stats.db ./bk.db  # backup prod DB
```
