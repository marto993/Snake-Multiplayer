# Snake Multiplayer

Real-time multiplayer Snake. Vanilla JS + Socket.IO + SQLite. **No build step, no bundler.** 3 production deps. Deployed on Fly.io.

## Commands

```bash
npm install
npm run dev    # nodemon, port 3000
npm test       # unit tests in test/ (node --test, no dependencies)
node tools/bot-duel.js extreme hard   # bot matches without network, to compare levels
npm start      # production
fly deploy     # deploy to Fly.io
```

## Files

| File | Lines | Owns |
|------|-------|------|
| `index.js` | ~1870 | Server: Express, Socket.IO, SQLite, game loop, rooms, bots in rooms, projectiles, elimination, consumables, frenzy, crown, per-frame game events |
| `game/difficulty.js` | ~90 | Difficulty table: `buildRoomConfig(difficulty, { roundTime })` builds the whole `room.config`; `POWERS` (big mouth, fan, frenzy, same on every level) and `consumableLimit(type, players)` |
| `game/projectiles.js` | ~80 | `traceProjectile()`: moves a shot several cells per tick at any angle, hitting the first segment within `hitRadius` of each step (pure, no side effects); `fanDirections()` for the fan's three shots |
| `game/geometry.js` | ~70 | Free-turn geometry: wrap-aware distances, swept contact (`touchedAlong`), portal wrap by center (`wrapPoint`), grid cell of a float position (pure) |
| `game/remains.js` | ~50 | `cutSnake(segments, damage)` (a hit takes `damage` segments off the tail; empty `kept` = eliminated) and `dropRemains()`: what a hit takes off stays as food for 10 s (pure) |
| `game/bots.js` | ~620 | Bot brain: `stepBot()` decides heading and fire once per tick from what a player sees; `SKILLS` holds the four levels (easy, medium, hard, extreme). Only the bot's own memory (`createBrain`) changes |
| `game/match.js` | ~70 | `matchResult()`: ranking (alive snakes by length, then eliminated ones from last to fall to first) and winners (ties all win); `matchOver()` (one or no snake alive, or no person alive); `frenzyFoodTarget()` and `crownHolder()` (longest snake, ties keep the previous holder) |
| `tools/bot-duel.js` | ~240 | Plays whole bot matches without server or network, seeded and on a simulated clock; `playMatch()` is also used by the tests. Repeats `gameLogicLoop`'s rules |
| `lib/assets.js` | ~190 | Serves the text files in `public/` precompressed (brotli 11 / gzip 9, in memory) and versions `index.html`'s local scripts and styles by content hash |
| `lib/security.js` | ~110 | Strict CSP (report-only for now): per-request nonce on every `<script>` of `index.html`, Trusted Types, and the `/csp-report` endpoint |
| `public/SnakeGame.js` | ~2450 | Client glue: socket handlers, game/UI state, controls (keys, touch, gamepad, click to fire), wiring events into the modules below. No drawing code. |
| `public/snakeClass.js` | ~380 | Snake entity — runs on **both** client and server. Effects (`effects`) and shot cooldown (`tryShot`) take the server time as `now` |
| `public/index.html` | ~340 | Scene markup only (no inline CSS) |
| `public/css/theme.css` | ~2700 | Space theme ("creatures of the void", palette from real astronomy; no neon or synthwave), `--bio-*` design tokens (names kept from the former abyss theme: `abyss` = void layers, `turquoise` = oxygen teal, `lime` = sulfur gold) |
| `public/js/net/motion.js` | ~250 | `window.Motion`: timeline of server frames, constant-speed interpolation (also loads in Node for tests) |
| `public/js/input/pad.js` | ~75 | `window.PadInput`: turns Gamepad API pads into a heading and a fire flag (stick deadzone, d-pad, A / right trigger, non-standard pads); `snapAngle()` (also loads in Node for tests) |
| `public/js/fx/particles.js` | ~450 | `window.Particles`: pooled particle systems |
| `public/js/render/arena.js` | ~3650 | `window.Arena`: game canvas renderer (DPR, glow sprites, nebula and stars, gas creatures, planets as food, consumables, effects, crown, idle attract mode, last-10s counter) |
| `public/js/ui/backdrop.js` | ~1500 | `window.Backdrop`: full-screen ambient canvas behind every scene (planet that recedes scene by scene, Milky Way, stars, giant silhouettes), moods |
| `public/js/ui/scenes.js` | ~2200 | `window.Scenes` / `Overlays` / `Toasts` / `HUD`: scene transitions, intro, countdown, final screen, toasts, DOM HUD |
| `docs/VISUAL_SPEC.md` | ~1480 | Visual spec: palette, typography, motion, scene map, effects catalog. Read it before touching visuals. |
| `docs/MOTION_SPEC.md` | ~160 | Design: fixed difficulty levels (implemented) and continuous 4000×4000 movement (not yet) |
| `docs/GAMEPLAY_SPEC.md` | ~200 | Design: shot cooldown, stacking effects, big mouth, fan, final frenzy, crown, controls and elimination (stage 5, with the bot measurements behind it), with their values (the anchor was tried and dropped) |
| `test/` | | Unit tests (`node --test`): motion timeline, gamepad reading, `Snake`, bots, difficulty table, geometry, projectile trace, remains, match result, static assets |

Script load order matters (index.html): socket.io → snakeClass → motion → particles → arena → backdrop → scenes → pad → SnakeGame. Each module is an IIFE that exposes its API on `window`; no ES modules. Declarations use `const`, and `let` only when the variable is reassigned; no `var`.

**Browser support:** This project's Baseline target is Baseline Widely available. Newly available features are allowed when they degrade gracefully (e.g. entry animations with `@starting-style`) or are feature-detected.

`game_stats.db` is auto-created. Schema lives in `index.js` near the top.

## Architecture

**Server-authoritative.** Server runs `gameLogicLoop()` at `config.gameSpeed` (70 / 66 / 60 ms for easy / medium / hard), validates everything, broadcasts `gameLogicFrame`. The client does not predict: input goes to the server (`newMove`, `attack`) and shows up in the next frames.

**Interpolation.** `SnakeGame.js` pushes every `gameLogicFrame` into a `Motion` timeline keyed by the server `timestamp`. Each animation frame renders the instant one tick (plus a jitter margin) behind the newest frame, interpolating linearly between the two frames around it, so visible speed is constant at any monitor refresh rate. Late frames are extrapolated up to half a tick. Clock corrections from each new frame are spread over time (render speed changes at most 5 %), so network jitter doesn't cause micro-stutters. Frames are interpolated on a smoothed server time (one tick after the previous frame, eased 10 % toward the real `timestamp`, kept in `frame.raw`), because the server doesn't tick exactly every `gameSpeed` ms and at 42 ms a 3 ms gap changes visible speed by 7 %. Foods, consumables, immunity and `Arena.on*` effects come from the frame the render has reached, so effects line up with the head. `snakeClass.js` still has the old `updateRenderPosition()` lerp, but the client no longer calls it.

**Network payload.** Socket.IO runs with `perMessageDeflate` (threshold 1 KB): consecutive frames are nearly identical, so with the shared compression context a frame goes from ~4.7 KB to ~0.11 KB on the wire (measured). Keep the default 32 KB window; a small one loses the cross-frame context. Static files go through `lib/assets.js` before `express.static`: plain URLs are `no-cache` with an ETag, `index.html` is rebuilt per request (CSP nonce, no ETag), and `index.html` rewrites `./…` script/style URLs to `?v=<hash>`, which are cached for a year. Reference new local scripts and styles as `./path` so they get versioned. Fly's proxy also compresses, but only at a fast brotli level; precompressed responses pass through as they are.

**Room state.** All state lives in `rooms` Map keyed by 6-char room code. Each room owns its own players, gameboard, foods, consumables, projectiles, timers, spectators. No global player state — players exist only inside a room.

**Match flow.** One match per start, no rounds. `startGame` → 3s countdown → `gameLogicLoop` interval + 120 s timer → `endMatch` → stats saved, `gameEnd` with `{ ranking, winners, ending }` → `resetRoomToWaiting` (same players and level). The match ends early (`ending: 'elimination'`) when `matchOver` says so, checked after each frame is emitted and when someone leaves mid-match: one or no snake alive, or no person alive (a room with bots doesn't make people watch bots). Otherwise it ends on time (`'time'`) and the longest snake alive wins. The client freezes the arena on the winner for 2 s, then shows the final screen: the host gets "Jugar de nuevo" (emits `startGame` again), everyone gets "Volver a la sala" and "Salir a las salas". A room is deleted only when its last player leaves.

## Non-obvious gotchas

- **Timer cleanup is mandatory.** `deleteRoom()` must `clearInterval` the game loop, round timer, **and** every entry in `consumableTimers`. Missed timers = memory leak + ghost game ticks.
- **DB path differs by env.** Dev: `./game_stats.db`. Prod (Fly): `/app/data/game_stats.db` (persistent volume `data_volume`). Logic at `index.js:14`.
- **Player IDs are compound:** `${username}_${Date.now()}`. Don't query players by `name`.
- **Room config comes from the difficulty table.** The host only picks `difficulty` (`easy` / `medium` / `hard`); `validateRoomConfig` passes it to `game/difficulty.js`, which builds the whole `room.config` and falls back to `medium` for anything unknown. Speed, shot cells per tick, extra food and shield timing vary by level; the 768 × 432 arena (16:9, 64 × 36 cells of 12 px), 2 to 8 players and start length 3 are fixed. The client reads the world size from `canvasWidth` / `canvasHeight`; `Motion` wraps each axis with its own period. `roundTime` (the match length) is 120 unless `ROUND_TIME` is set. Every round reset goes through `resetPlayerForRound()`.
- **Portal wraparound breaks interpolation.** When a snake teleports edge-to-edge, naive lerp animates across the whole canvas. `motion.js` interpolates the short way around (`wrapDelta`) and moves a segment to the opposite edge once its center crosses; `arena.js` cuts the continuous body path wherever consecutive segments are > canvas/2 apart. Preserve both when touching rendering.
- **Game events for effects.** `gameLogicFrame` carries `foodEvents`, `hitEvents`, `blockEvents`, `projectileEvents`, `expiredProjectiles` (always present, possibly empty), plus coordinates on `portals` and `consumableEvents`. The fan's two side shots have `spread: true` (the arena shows the shot's cost once). `gameState` also carries `frenzy` and `leaderId` (crown). Shots fired between ticks are buffered in `room.pendingProjectileEvents`. `SnakeGame.js` forwards each one to an `Arena.on*` hook when the render reaches that frame (`timeline.drain`), not when it arrives.
- **Remains are foods with an expiry.** A hit drops the lost segments as foods with `remains: true` and `expiresAt` (server ms). They don't respawn when eaten (base food does, via `respawnFood`) and `gameLogicLoop` drops them once expired. The client fades them out in their last 2 s using the timeline's render time (`food.fade`).
- **Rendering performance.** No `shadowBlur` in per-frame drawing: glow comes from cached offscreen sprites + `'lighter'` compositing. `arena.js` drops quality automatically under load. Don't rebuild DOM per frame; `HUD.update` diffs by player id.
- **Match end keeps the room.** `endMatch` resets the room to waiting right after emitting `gameEnd`, so the `updatePlayers` that follows already carries length-3 snakes. The client keeps the frozen arena and the HUD board on the final result while `matchFinished` is set (cleared by the next `countdown`/`gameStart`). `roundTime`, `roundLive`, `roundTimeUpdate` and `Arena.onRound*` keep their old names but mean the single match.
- **Spectator vs player on join.** `joinRoom` branches on `room.gameState.playing`: in-progress room → spectator (added to `room.spectators` Map), lobby → player. Both paths must be handled when adding join logic.
- **Host migration on disconnect.** If the disconnecting socket is `room.host`, promote `room.players[0]` and emit `newHost`. If no players remain, delete the room.
- **Shared snake class.** `snakeClass.js` is loaded by both server (`require`) and client (`<script>`). Don't add browser-only or Node-only APIs to it.
- **Free turning (prototype branch).** `direction` is a unit vector; the client sends `steer { angle }` (arrow combos for 8 headings, the touch joystick or a gamepad stick) and the server turns `heading` toward it at most `turnDegrees` per tick (difficulty table), then advances one cell. Positions are floats rounded to 0.1 px, so never compare them with `===`: eating, shield pickup, hits and the "own shot in front" check go through distances in `game/geometry.js`. Portals wrap by the segment center without snapping to the grid. `newMove` still works for old clients (an arrow becomes a target heading).
- **Hit damage and elimination.** A hit takes `hitDamage` (4) segments off the tail wherever it lands (`headshot` is only visual). A snake left with no segments is eliminated: `Snake.eliminate(now)` sets `gameover`, empties its segments and effects and records `eliminatedAt`. It stays in `room.players`: the loop doesn't move it, projectiles, bots and the crown skip it, `steer`/`attack` are ignored, and its `hitEvents` entry has `eliminated: true`. The client hides its controls and toasts who went out (not when that elimination ends the match). Snakes can arrive with empty `segments`, so never read `segments[0]` without checking. At "¡Ya!" every snake gets `spawnShield` (3) s of shield that blocks everything without being spent (`gameState.spawnGuardUntil`): they spawn in a column 3 cells apart with 3 segments.
- **Attack cost.** Firing a projectile pops one tail segment. Snakes with `< 2` segments can't attack. Two shots from the same player are at least `shotCooldownMs` (200) apart (`Snake.tryShot`); a request up to `Snake.SHOT_SLACK_MS` (25) early is accepted but counted at its due time, so network jitter doesn't drop shots from held fire and the rate never exceeds one per cooldown. With the fan, one shot fires three projectiles and still costs one segment.
- **Effects stack.** A snake has `effects = { immunity, bigMouth, fan }`, one server-time expiry per type (only active ones are serialized). Picking up a type that is already active restarts its time, it doesn't add. There is no `activeConsumable` any more. Each consumable type has its own spawn timer and map limit (`consumableLimit`). The HUD shows one chip per active effect.
- **Frenzy and crown.** With `frenzy.lastSeconds` (20) left, `gameState.frenzy` turns on and `gameLogicLoop` adds one base food per tick until there is 50 % more. `gameState.leaderId` is recomputed every tick with `crownHolder`. Both reset in `resetRoomToWaiting` and `startGame`.
- **Arena size depends on the mode.** In `room` the arena shares the screen with the panel and dock; in `game` it grows to all the available space (theme.css section 18). The switch to `game` happens on the first `countdown`, not on `gameStart`, so the match starts on a still arena; `Scenes.setMode` animates it with a FLIP on `.arena-stage` and calls `Arena.resize()`. `--arena-size` is the width; the height comes from `--arena-aspect`.
- **Container units, not `vw`.** `html` is an inline-size container, so `100cqi` is the available width without the scrollbar, for the scenes and for the dock alike; use it instead of `100vw`. `.arena-stage` is a size container: its overlays use `cqh`. Inside `.arena-stage`, don't use `--arena-size`: its `100cqi` would resolve against the arena, not the page.
- **CSP (report-only).** `index.html` gets a fresh nonce on every `<script>` per request and a `Content-Security-Policy-Report-Only` with `'strict-dynamic'` and Trusted Types (`lib/security.js`). Don't add inline scripts, inline event handlers (`onclick=…`) or `innerHTML`: they would show up as violations in `/csp-report` (logged by the server). Chromium only registers `Reporting-Endpoints` over HTTPS, so local reports only arrive through `report-uri` browsers or a TLS proxy. When production reports stay clean, switch the header to `Content-Security-Policy`.
- **No mouse aiming.** The mouse doesn't steer: pointing at a rival made aiming much easier than with keys. Left click on the arena still fires. On a hybrid device, moving the mouse hides the touch controls (`handlePointerMove`).
- **Gamepad.** `updatePad()` in `SnakeGame.js` polls every connected pad every animation frame through `PadInput.readAll` (the first pad with input steers, any pad fires; some keyboards and receivers show up as a pad in slot 0): the left stick (deadzone 0.3) or the d-pad steers, A or the right trigger fires every `shotCooldownMs` while held. A stick at rest sends nothing, so keys still work. `STICK_SNAP` (0 = any angle, 8 = eight headings like the keys) applies to the gamepad stick and the touch joystick alike. Browsers expose a pad only after a button press, and only in a secure context (HTTPS or `localhost`, not the dev server opened by LAN IP). It rumbles on hits when `vibrationActuator.playEffect` exists and the pad was the last control used.
- **Bots.** A bot is a `Snake` in `room.players` with `bot` set to its level and no socket; ids start with `bot_`. `runBots()` runs at the top of `gameLogicLoop`, before projectiles move, so a bot acts on the state of the last frame like a person does, and its shots go into that tick's `projectileEvents`. Bots only decide (`steerTo`, `createProjectile`): turning, cooldown and shot cost stay with the server. The host changes them with `setBotCount` / `setBotLevel` while the room waits. Bots are never host and never keep a room alive: when the last person leaves, the room is deleted. A match with bots doesn't touch the ranking. `createRoom` with `solo: true` makes a room with 3 medium bots that `getRooms` doesn't list (code and invites still work). Levels are tuned with `tools/bot-duel.js` against human-like proxies (reaction and 8 headings); the reaction delay (`delay`, in ticks) moves the result most. Bots value a shot that eliminates (`KILL_VALUE`) and weigh going out when dodging (`DEATH_COST`); a fire decided `delay` ticks ago is dropped if their own body is now in the line (`ownBodyInLine`). With elimination, `extreme` knocks `hard` out in about 4 s. If `gameLogicLoop`'s rules change, change `tools/bot-duel.js` too.
- **Touch controls.** `#touchControls` (floating joystick anywhere outside the fire button, fire button bottom right) is shown by `updateTouchControls()` in `SnakeGame.js` to players (not spectators) on touch screens from the countdown on, so a thumb held before "¡Ya!" steers as soon as the match starts. The joystick sends the same `steer` event as the keys and the gamepad. On touch screens in portrait, CSS covers the game with `#rotateHint` (the match is played in landscape).

## Testing

`npm test` runs the unit tests in `test/` (Node's built-in runner). They cover the pieces that load in Node without a browser or a running server: `motion.js`, `pad.js`, `Snake` (reset, steering, effects, shot cooldown, elimination), `game/bots.js` (shot prediction against the real projectile trace, dodging, going for the kill, reaction delay, spawn shield, level order in seeded matches), `game/difficulty.js`, `game/geometry.js`, `game/projectiles.js`, `game/remains.js`, `game/match.js`, `lib/assets.js` and `lib/security.js`. Gameplay still needs a manual check: validate changes by running `npm run dev` and opening multiple browser windows (use incognito for distinct sessions). Inspect DB with `sqlite3 game_stats.db`.

`ROUND_TIME=10 npm run dev` shortens the match for testing (positive integers only; default 120). Headless browser checks work with `puppeteer-core` + `/snap/bin/chromium` (the snap can't write to host `/tmp`, so use a dir under `~`).

## Deployment

Fly.io app `snake-multiplayer`, region `gru` (São Paulo), auto-stop when idle, volume `data_volume` for SQLite. Config in `fly.toml` and `Dockerfile`. App URL: `snake-multiplayer.fly.dev`.

**Every push to `main` deploys.** `.github/workflows/deploy.yml` runs `npm test` and, if it passes, `flyctl deploy --remote-only` with the `FLY_API_TOKEN` repo secret (an app-scoped deploy token). It can also be run by hand from the Actions tab. To deploy by hand from this machine, run `fly deploy` from a clean checkout of `main`: it uploads the local folder, ignored files included.

```bash
fly logs                                          # tail prod logs
fly ssh console                                   # shell into machine
fly ssh sftp get /app/data/game_stats.db ./bk.db  # backup prod DB
```
