# Snake Multiplayer

Real-time multiplayer Snake. Vanilla JS + Socket.IO + SQLite. **No build step, no bundler.** 3 production deps. Deployed on Fly.io.

## Commands

```bash
npm install
npm run dev    # nodemon, port 3000
npm test       # unit tests in test/ (node --test, no dependencies)
npm start      # production
fly deploy     # deploy to Fly.io
```

## Files

| File | Lines | Owns |
|------|-------|------|
| `index.js` | ~1850 | Server: Express, Socket.IO, SQLite, game loop, rooms, projectiles, consumables, per-frame game events |
| `game/difficulty.js` | ~50 | Difficulty table: `buildRoomConfig(difficulty, { roundTime })` builds the whole `room.config` |
| `game/projectiles.js` | ~70 | `traceProjectile()`: moves a shot several cells per tick at any angle, hitting the first segment within `hitRadius` of each step (pure, no side effects) |
| `game/geometry.js` | ~70 | Free-turn geometry: wrap-aware distances, swept contact (`touchedAlong`), portal wrap by center (`wrapPoint`), grid cell of a float position (pure) |
| `game/remains.js` | ~55 | `cutSnake()` (hit damage) and `dropRemains()`: what a hit cuts off stays as food for 10 s (pure) |
| `game/match.js` | ~25 | `matchResult()`: ranking by length and winners (ties all win) at the end of the match |
| `public/SnakeGame.js` | ~2000 | Client glue: socket handlers, game/UI state, wiring events into the modules below. No drawing code. |
| `public/snakeClass.js` | ~350 | Snake entity — runs on **both** client and server |
| `public/index.html` | ~360 | Scene markup only (no inline CSS) |
| `public/css/theme.css` | ~2600 | Bioluminescent theme, `--bio-*` design tokens |
| `public/js/net/motion.js` | ~250 | `window.Motion`: timeline of server frames, constant-speed interpolation (also loads in Node for tests) |
| `public/js/fx/particles.js` | ~450 | `window.Particles`: pooled particle systems |
| `public/js/render/arena.js` | ~3100 | `window.Arena`: game canvas renderer (DPR, glow sprites, effects, idle attract mode, last-10s counter) |
| `public/js/ui/backdrop.js` | ~1150 | `window.Backdrop`: full-screen ambient canvas behind every scene, moods |
| `public/js/ui/scenes.js` | ~2300 | `window.Scenes` / `Overlays` / `Toasts` / `HUD`: scene transitions, intro, countdown, final screen, toasts, DOM HUD |
| `docs/VISUAL_SPEC.md` | ~1400 | Visual spec: palette, typography, motion, scene map, effects catalog. Read it before touching visuals. |
| `docs/MOTION_SPEC.md` | ~160 | Design: fixed difficulty levels (implemented) and continuous 4000×4000 movement (not yet) |
| `test/` | | Unit tests (`node --test`): motion timeline, `Snake.reset`, difficulty table, projectile trace, remains, match result |

Script load order matters (index.html): socket.io → snakeClass → motion → particles → arena → backdrop → scenes → SnakeGame. Each module is an IIFE that exposes its API on `window`; no ES modules.

**Browser support:** This project's Baseline target is Baseline Widely available. Newly available features are allowed when they degrade gracefully (e.g. entry animations with `@starting-style`) or are feature-detected.

`game_stats.db` is auto-created. Schema lives in `index.js` near the top.

## Architecture

**Server-authoritative.** Server runs `gameLogicLoop()` at `config.gameSpeed` (70 / 66 / 60 ms for easy / medium / hard), validates everything, broadcasts `gameLogicFrame`. The client does not predict: input goes to the server (`newMove`, `attack`) and shows up in the next frames.

**Interpolation.** `SnakeGame.js` pushes every `gameLogicFrame` into a `Motion` timeline keyed by the server `timestamp`. Each animation frame renders the instant one tick (plus a jitter margin) behind the newest frame, interpolating linearly between the two frames around it, so visible speed is constant at any monitor refresh rate. Late frames are extrapolated up to half a tick. Clock corrections from each new frame are spread over time (render speed changes at most 5 %), so network jitter doesn't cause micro-stutters. Frames are interpolated on a smoothed server time (one tick after the previous frame, eased 10 % toward the real `timestamp`, kept in `frame.raw`), because the server doesn't tick exactly every `gameSpeed` ms and at 42 ms a 3 ms gap changes visible speed by 7 %. Foods, consumables, immunity and `Arena.on*` effects come from the frame the render has reached, so effects line up with the head. `snakeClass.js` still has the old `updateRenderPosition()` lerp, but the client no longer calls it.

**Room state.** All state lives in `rooms` Map keyed by 6-char room code. Each room owns its own players, gameboard, foods, consumables, projectiles, timers, spectators. No global player state — players exist only inside a room.

**Match flow.** One match per start, no rounds. `startGame` → 3s countdown → `gameLogicLoop` interval + 120 s timer → `endMatch` → stats saved, `gameEnd` with `{ ranking, winners }` → `resetRoomToWaiting` (same players and level). The client freezes the arena on the winner for 2 s, then shows the final screen: the host gets "Jugar de nuevo" (emits `startGame` again), everyone gets "Volver a la sala" and "Salir a las salas". A room is deleted only when its last player leaves.

## Non-obvious gotchas

- **Timer cleanup is mandatory.** `deleteRoom()` must `clearInterval` the game loop, round timer, **and** every entry in `consumableTimers`. Missed timers = memory leak + ghost game ticks.
- **DB path differs by env.** Dev: `./game_stats.db`. Prod (Fly): `/app/data/game_stats.db` (persistent volume `data_volume`). Logic at `index.js:14`.
- **Player IDs are compound:** `${username}_${Date.now()}`. Don't query players by `name`.
- **Room config comes from the difficulty table.** The host only picks `difficulty` (`easy` / `medium` / `hard`); `validateRoomConfig` passes it to `game/difficulty.js`, which builds the whole `room.config` and falls back to `medium` for anything unknown. Speed, shot cells per tick, extra food and shield timing vary by level; the 768 × 432 arena (16:9, 64 × 36 cells of 12 px), 2 to 8 players and start length 3 are fixed. The client reads the world size from `canvasWidth` / `canvasHeight`; `Motion` wraps each axis with its own period. `roundTime` (the match length) is 120 unless `ROUND_TIME` is set. Every round reset goes through `resetPlayerForRound()`.
- **Portal wraparound breaks interpolation.** When a snake teleports edge-to-edge, naive lerp animates across the whole canvas. `motion.js` interpolates the short way around (`wrapDelta`) and moves a segment to the opposite edge once its center crosses; `arena.js` cuts the continuous body path wherever consecutive segments are > canvas/2 apart. Preserve both when touching rendering.
- **Game events for effects.** `gameLogicFrame` carries `foodEvents`, `hitEvents`, `blockEvents`, `projectileEvents`, `expiredProjectiles` (always present, possibly empty), plus coordinates on `portals` and `consumableEvents`. Shots fired between ticks are buffered in `room.pendingProjectileEvents`. `SnakeGame.js` forwards each one to an `Arena.on*` hook when the render reaches that frame (`timeline.drain`), not when it arrives.
- **Remains are foods with an expiry.** A hit drops the lost segments as foods with `remains: true` and `expiresAt` (server ms). They don't respawn when eaten (base food does, via `respawnFood`) and `gameLogicLoop` drops them once expired. The client fades them out in their last 2 s using the timeline's render time (`food.fade`).
- **Rendering performance.** No `shadowBlur` in per-frame drawing: glow comes from cached offscreen sprites + `'lighter'` compositing. `arena.js` drops quality automatically under load. Don't rebuild DOM per frame; `HUD.update` diffs by player id.
- **Match end keeps the room.** `endMatch` resets the room to waiting right after emitting `gameEnd`, so the `updatePlayers` that follows already carries length-3 snakes. The client keeps the frozen arena and the HUD board on the final result while `matchFinished` is set (cleared by the next `countdown`/`gameStart`). `roundTime`, `roundLive`, `roundTimeUpdate` and `Arena.onRound*` keep their old names but mean the single match.
- **Spectator vs player on join.** `joinRoom` branches on `room.gameState.playing`: in-progress room → spectator (added to `room.spectators` Map), lobby → player. Both paths must be handled when adding join logic.
- **Host migration on disconnect.** If the disconnecting socket is `room.host`, promote `room.players[0]` and emit `newHost`. If no players remain, delete the room.
- **Shared snake class.** `snakeClass.js` is loaded by both server (`require`) and client (`<script>`). Don't add browser-only or Node-only APIs to it.
- **Free turning (prototype branch).** `direction` is a unit vector; the client sends `steer { angle }` (mouse, or arrow combos for 8 headings) and the server turns `heading` toward it at most `turnDegrees` per tick (difficulty table), then advances one cell. Positions are floats rounded to 0.1 px, so never compare them with `===`: eating, shield pickup, hits and the "own shot in front" check go through distances in `game/geometry.js`. Portals wrap by the segment center without snapping to the grid. `newMove` still works for old clients (an arrow becomes a target heading).
- **Attack cost.** Firing a projectile pops one tail segment. Snakes with `< 2` segments can't attack.
- **Arena size depends on the mode.** In `room` the arena shares the screen with the panel and dock; in `game` it grows to all the available space (theme.css section 18). The switch to `game` happens on the first `countdown`, not on `gameStart`, so the match starts on a still arena; `Scenes.setMode` animates it with a FLIP on `.arena-stage` and calls `Arena.resize()`. `--arena-size` is the width; the height comes from `--arena-aspect`. Never cache the canvas rect: mouse steering converts the pointer to arena coordinates every frame.
- **Touch controls.** `#touchControls` (floating joystick anywhere outside the fire button, fire button bottom right) is shown by `updateTouchControls()` in `SnakeGame.js` to players (not spectators) on touch screens from the countdown on, so a thumb held before "¡Ya!" steers as soon as the match starts. The joystick sends the same `steer` event as the mouse. On touch screens in portrait, CSS covers the game with `#rotateHint` (the match is played in landscape).

## Testing

`npm test` runs the unit tests in `test/` (Node's built-in runner). They cover the pieces that load in Node without a browser or a running server: `motion.js`, `Snake` (reset and steering), `game/difficulty.js`, `game/geometry.js`, `game/projectiles.js`, `game/remains.js` and `game/match.js`. Gameplay still needs a manual check: validate changes by running `npm run dev` and opening multiple browser windows (use incognito for distinct sessions). Inspect DB with `sqlite3 game_stats.db`.

`ROUND_TIME=10 npm run dev` shortens the match for testing (positive integers only; default 120). Headless browser checks work with `puppeteer-core` + `/snap/bin/chromium` (the snap can't write to host `/tmp`, so use a dir under `~`).

## Deployment

Fly.io app `snake-multiplayer`, region `gru` (São Paulo), auto-stop when idle, volume `data_volume` for SQLite. Config in `fly.toml` and `Dockerfile`. App URL: `snake-multiplayer.fly.dev`.

**Every push to `main` deploys.** `.github/workflows/deploy.yml` runs `npm test` and, if it passes, `flyctl deploy --remote-only` with the `FLY_API_TOKEN` repo secret (an app-scoped deploy token). It can also be run by hand from the Actions tab. To deploy by hand from this machine, run `fly deploy` from a clean checkout of `main`: it uploads the local folder, ignored files included.

```bash
fly logs                                          # tail prod logs
fly ssh console                                   # shell into machine
fly ssh sftp get /app/data/game_stats.db ./bk.db  # backup prod DB
```
