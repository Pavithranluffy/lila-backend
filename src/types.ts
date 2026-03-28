// Game Types for Tic-Tac-Toe

export type PlayerMark = 'X' | 'O';
export type CellValue = PlayerMark | null;
export type GameMode = 'classic' | 'timed';
export type GameStatus = 'waiting' | 'playing' | 'finished';

export interface PlayerInfo {
  odUserId: string;
  odName: string;
  odSessionId: string;
  xUserId: string;
  xName: string;
  xSessionId: string;
}

export interface GameState {
  board: CellValue[];
  players: PlayerInfo;
  currentTurn: PlayerMark;
  gameMode: GameMode;
  turnStartTime: number;
  turnTimeLimit: number;
  status: GameStatus;
  winner: PlayerMark | 'draw' | null;
  winningCells: number[];
  moveCount: number;
}

export interface MoveMessage {
  cellIndex: number;
}

export interface MatchLabel {
  open: boolean;
  gameMode: GameMode;
}

// Op Codes for real-time messages
export enum OpCode {
  MOVE = 1,
  STATE_UPDATE = 2,
  GAME_OVER = 3,
  TIMER_SYNC = 4,
  PLAYER_LEFT = 5,
  READY = 6
}

// Win patterns for Tic-Tac-Toe
export const WIN_PATTERNS: number[][] = [
  [0, 1, 2], // Top row
  [3, 4, 5], // Middle row
  [6, 7, 8], // Bottom row
  [0, 3, 6], // Left column
  [1, 4, 7], // Middle column
  [2, 5, 8], // Right column
  [0, 4, 8], // Diagonal top-left to bottom-right
  [2, 4, 6]  // Diagonal top-right to bottom-left
];

// Leaderboard IDs
export const LEADERBOARD_WINS = 'global_wins';
export const LEADERBOARD_LOSSES = 'global_losses';
export const LEADERBOARD_DRAWS = 'global_draws';
export const LEADERBOARD_STREAK = 'global_streak';
export const LEADERBOARD_WEEKLY = 'weekly_wins';

// Match constants
export const MATCH_TICK_RATE = 2; // 2 ticks per second
export const TIMED_MODE_TURN_LIMIT = 30; // 30 seconds per turn
export const CLASSIC_MODE_TURN_LIMIT = 0; // No limit
