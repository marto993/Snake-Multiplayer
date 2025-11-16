/**
 * Snake Multiplayer - Constantes Globales
 * Centraliza todos los valores de configuración y constantes del juego
 */

// === CANVAS ===
export const CANVAS = {
  WIDTH: 600,
  HEIGHT: 600,
  INFO_HEIGHT: 90,
  BACKGROUND_COLOR: '#010409',
  GRID_COLOR: '#161b22',
};

// === GAME RULES ===
export const GAME_RULES = {
  MAX_ROUNDS: 3,
  ROUND_TIME_SECONDS: 60,
  COUNTDOWN_SECONDS: 3,
  MAX_MOVE_QUEUE: 3,
  MIN_ATTACK_LENGTH: 2,
  ATTACK_COST_SEGMENTS: 1,
  HEAD_HIT_DAMAGE: 3,
};

// === DEFAULT CONFIG ===
export const DEFAULT_CONFIG = {
  MAX_PLAYERS: 8,
  MIN_PLAYERS: 2,
  GAME_SPEED: 83,  // ms
  SEGMENT_SIZE: 20, // px
};

// === COLORS ===
export const COLORS = {
  // Player colors
  PLAYERS: [
    '#58a6ff',
    '#a371f7',
    '#7dd3fc',
    '#fbbf24',
    '#f85149',
    '#c084fc',
    '#3fb950',
    '#f97316'
  ],

  // UI colors
  BACKGROUND: '#010409',
  GRID: '#161b22',
  FOOD: '#a371f7',
  FOOD_GLOW: '#c084fc',
  PROJECTILE: '#fbbf24',
  TEXT_PRIMARY: '#c9d1d9',
  TEXT_SECONDARY: '#8b949e',
  ACCENT: '#58a6ff',
  SUCCESS: '#3fb950',
  WARNING: '#d29922',
  DANGER: '#f85149',
};

// === CONSUMABLES ===
export const CONSUMABLES = {
  IMMUNITY: {
    TYPE: 'immunity',
    COLOR: '#0101FF',
    GLOW_COLOR: '#1F1FEF',
    NAME: 'Inmunidad',
    DEFAULT_SPAWN_INTERVAL: 5,  // seconds
    DEFAULT_DURATION: 5,         // seconds
  }
};

// === RENDER ===
export const RENDER = {
  TARGET_FPS: 60,
  INTERPOLATION_MIN: 0.08,
  INTERPOLATION_MAX: 0.3,
  PORTAL_THRESHOLD: 2, // segmentSize multiplier for portal detection
  PULSE_SPEED: 0.01,
  PULSE_RANGE: 0.1,
  FOOD_PULSE_SCALE: 0.2,
  GLOW_BLUR: 5,
  SHADOW_BLUR: 8,
};

// === NOTIFICATIONS ===
export const NOTIFICATIONS = {
  DURATION: 3000,          // ms
  ENTER_DURATION: 300,     // ms
  EXIT_DURATION: 300,      // ms
  SPACING: 45,             // px between notifications
  INITIAL_Y: 20,           // px from top
  PADDING: 20,             // px
  HEIGHT: 35,              // px
  FONT_SIZE: 16,           // px
  BORDER_RADIUS: 8,        // px

  TYPES: {
    INFO: 'info',
    SUCCESS: 'success',
    ERROR: 'error',
    INVITATION: 'invitation',
  },

  COLORS: {
    INFO: {
      BG: 'rgba(88, 166, 255, 0.9)',
      TEXT: '#ffffff',
      BORDER: '#58a6ff',
    },
    SUCCESS: {
      BG: 'rgba(63, 185, 80, 0.9)',
      TEXT: '#ffffff',
      BORDER: '#3fb950',
    },
    ERROR: {
      BG: 'rgba(248, 81, 73, 0.9)',
      TEXT: '#ffffff',
      BORDER: '#f85149',
    },
    INVITATION: {
      BG: 'rgba(88, 166, 255, 0.9)',
      TEXT: '#ffffff',
      BORDER: '#58a6ff',
    },
  },
};

// === COUNTDOWN ===
export const COUNTDOWN = {
  SHOW_UNDER_SECONDS: 10,
  BASE_FONT_SIZE: 220,
  FONT_GROWTH: 8,
  PULSE_SPEED: 0.01,
  PULSE_SCALE: 0.1,
  ALPHA_NORMAL: 0.1,
  ALPHA_WARNING: 0.15,
  ALPHA_DANGER: 0.2,
  SHADOW_BLUR: 20,
  STROKE_WIDTH: 6,
};

// === SOCKET EVENTS ===
export const SOCKET_EVENTS = {
  // Client → Server
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  SPECTATE_ROOM: 'spectateRoom',
  UPDATE_ROOM_CONFIG: 'updateRoomConfig',
  START_GAME: 'startGame',
  NEW_MOVE: 'newMove',
  ATTACK: 'attack',
  INVITE_PLAYER: 'invitePlayer',
  GET_ONLINE_PLAYERS: 'getOnlinePlayers',
  GET_OR_CREATE_PROFILE: 'getOrCreateProfile',
  GET_PLAYER_STATS: 'getPlayerStats',
  GET_LEADERBOARD: 'getLeaderboard',
  GET_ROOMS: 'getRooms',
  BACK_TO_MENU: 'backToMenu',
  LOGOUT: 'logout',

  // Server → Client
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  GAME_ERROR: 'gameError',
  ROOM_CREATED: 'roomCreated',
  ROOM_JOINED: 'roomJoined',
  ROOMS_LIST: 'roomsList',
  NEW_HOST: 'newHost',
  UPDATE_PLAYERS: 'updatePlayers',
  CONFIG_UPDATED: 'configUpdated',
  UPDATE_SCORES: 'updateScores',
  GAME_START: 'gameStart',
  SPECTATING_STARTED: 'spectatingStarted',
  SPECTATOR_JOINED: 'spectatorJoined',
  SPECTATOR_LEFT: 'spectatorLeft',
  COUNTDOWN: 'countdown',
  ROUND_TIME_UPDATE: 'roundTimeUpdate',
  GAME_LOGIC_FRAME: 'gameLogicFrame',
  ROUND_END: 'roundEnd',
  GAME_END: 'gameEnd',
  PLAYER_STATS: 'playerStats',
  PROFILE_LOADED: 'profileLoaded',
  PROFILE_ERROR: 'profileError',
  LEADERBOARD: 'leaderboard',
  ROOM_FINISHED: 'roomFinished',
  BACK_TO_MENU_SUCCESS: 'backToMenuSuccess',
  ONLINE_PLAYERS_LIST: 'onlinePlayersList',
  INVITATION_RECEIVED: 'invitationReceived',
  INVITATION_SENT: 'invitationSent',
};

// === KEYCODES ===
export const KEYCODES = {
  ARROW_LEFT: 37,
  ARROW_UP: 38,
  ARROW_RIGHT: 39,
  ARROW_DOWN: 40,
  W: 87,
  A: 65,
  S: 83,
  D: 68,
  SPACE: 32,
};

// === DIRECTIONS ===
export const DIRECTIONS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

// === UI ===
export const UI = {
  USERNAME_MIN_LENGTH: 2,
  USERNAME_MAX_LENGTH: 20,
  ROOM_ID_LENGTH: 6,
  REFRESH_INTERVAL: 5000,    // ms
  STATS_REFRESH_DELAY: 500,  // ms
};

// === STORAGE KEYS ===
export const STORAGE = {
  PLAYER_PROFILE: 'snakePlayerProfile',
  PLAYER_ID: 'snakePlayerId',
};

// === INFO CANVAS LAYOUT ===
export const INFO_CANVAS = {
  LEFT_SECTION_WIDTH: 150,
  RIGHT_SECTION_OFFSET: 20,
  PADDING: 20,
  ROUND_FONT_SIZE: 22,
  TIME_FONT_SIZE: 28,
  PLAYER_FONT_SIZE: 18,
  SCORE_FONT_SIZE: 16,
  DIVIDER_PADDING: 10,
  START_Y: 40,
  MIN_PLAYER_HEIGHT: 40,
};

// === SNAKE ===
export const SNAKE = {
  INITIAL_LENGTH: 1,
  EYE_SIZE_RATIO: 0.2,
  EYE_OFFSET_RATIO: 0.3,
  SEGMENT_PADDING: 1,
};

// === FOOD ===
export const FOOD = {
  PADDING: 2,
  PULSE_SPEED: 0.01,
  PULSE_SCALE: 0.1,
  FONT_SIZE_RATIO: 0.4,
  STROKE_WIDTH: 2,
};

// === PROJECTILE ===
export const PROJECTILE = {
  SIZE_RATIO: 0.6,
  ROTATION: Math.PI / 4,
  INTERPOLATION_SPEED: 0.2,
};

// === HEXAGON (Consumables) ===
export const HEXAGON = {
  SIDES: 6,
  PULSE_SPEED: 0.008,
  PULSE_SCALE: 0.15,
  SIZE_RATIO: 0.45,
  INNER_SIZE_RATIO: 0.4,
  OUTER_ALPHA: 0.3,
  INNER_ALPHA: 0.8,
  GLOW_MULTIPLIER: 1.3,
  STROKE_WIDTH: 2,
};

// === RETRIES ===
export const RETRIES = {
  MAX_ATTEMPTS: 4,
  BACKOFF_BASE: 2000,  // ms
};

export default {
  CANVAS,
  GAME_RULES,
  DEFAULT_CONFIG,
  COLORS,
  CONSUMABLES,
  RENDER,
  NOTIFICATIONS,
  COUNTDOWN,
  SOCKET_EVENTS,
  KEYCODES,
  DIRECTIONS,
  UI,
  STORAGE,
  INFO_CANVAS,
  SNAKE,
  FOOD,
  PROJECTILE,
  HEXAGON,
  RETRIES,
};
