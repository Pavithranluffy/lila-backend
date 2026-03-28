// Server-Authoritative Match Handler for Tic-Tac-Toe

import {
  GameState,
  PlayerMark,
  GameMode,
  MoveMessage,
  MatchLabel,
  OpCode,
  WIN_PATTERNS,
  LEADERBOARD_WINS,
  LEADERBOARD_LOSSES,
  LEADERBOARD_DRAWS,
  LEADERBOARD_STREAK,
  MATCH_TICK_RATE,
  TIMED_MODE_TURN_LIMIT,
  CLASSIC_MODE_TURN_LIMIT
} from './types';

// Initialize a new match
const matchInit: nkruntime.MatchInitFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  params: { [key: string]: string }
): { state: nkruntime.MatchState; tickRate: number; label: string } {

  const gameMode: GameMode = (params?.mode as GameMode) || 'classic';
  const turnTimeLimit = gameMode === 'timed' ? TIMED_MODE_TURN_LIMIT : CLASSIC_MODE_TURN_LIMIT;

  const state: GameState = {
    board: Array(9).fill(null),
    players: {
      odUserId: '',
      odName: '',
      odSessionId: '',
      xUserId: '',
      xName: '',
      xSessionId: ''
    },
    currentTurn: 'X',
    gameMode: gameMode,
    turnStartTime: 0,
    turnTimeLimit: turnTimeLimit,
    status: 'waiting',
    winner: null,
    winningCells: [],
    moveCount: 0
  };

  const label: MatchLabel = {
    open: true,
    gameMode: gameMode
  };

  logger.info(`Match initialized with mode: ${gameMode}`);

  return {
    state,
    tickRate: MATCH_TICK_RATE,
    label: JSON.stringify(label)
  };
};

// Handle join attempt
const matchJoinAttempt: nkruntime.MatchJoinAttemptFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presence: nkruntime.Presence,
  metadata: { [key: string]: any }
): { state: nkruntime.MatchState; accept: boolean; rejectMessage?: string } {

  const gameState = state as GameState;

  // Check if match is already full
  const playerCount = (gameState.players.xUserId ? 1 : 0) + (gameState.players.odUserId ? 1 : 0);

  if (playerCount >= 2) {
    logger.warn(`Rejecting player ${presence.userId} - match is full`);
    return {
      state: gameState,
      accept: false,
      rejectMessage: 'Match is full'
    };
  }

  if (gameState.status === 'finished') {
    return {
      state: gameState,
      accept: false,
      rejectMessage: 'Match has ended'
    };
  }

  logger.info(`Player ${presence.userId} attempting to join`);

  return {
    state: gameState,
    accept: true
  };
};

// Handle player joining
const matchJoin: nkruntime.MatchJoinFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {

  const gameState = state as GameState;

  for (const presence of presences) {
    // Get user account for display name (prefer displayName, fallback to username)
    const users = nk.usersGetId([presence.userId]);
    const user = users.length > 0 ? users[0] : null;
    const displayName = user?.displayName || user?.username || `Player_${presence.userId.substring(0, 6)}`;

    // Assign player to X or O
    if (!gameState.players.xUserId) {
      gameState.players.xUserId = presence.userId;
      gameState.players.xName = displayName;
      gameState.players.xSessionId = presence.sessionId;
      logger.info(`Player ${displayName} joined as X`);
    } else if (!gameState.players.odUserId) {
      gameState.players.odUserId = presence.userId;
      gameState.players.odName = displayName;
      gameState.players.odSessionId = presence.sessionId;
      logger.info(`Player ${displayName} joined as O`);
    }
  }

  // Check if we have 2 players to start the game
  if (gameState.players.xUserId && gameState.players.odUserId) {
    gameState.status = 'playing';
    gameState.turnStartTime = Date.now();

    // Update label to show match is no longer open
    const label: MatchLabel = {
      open: false,
      gameMode: gameState.gameMode
    };
    dispatcher.matchLabelUpdate(JSON.stringify(label));

    logger.info('Game started - both players joined');
  }

  // Broadcast state to all players
  broadcastState(dispatcher, gameState);

  return { state: gameState };
};

// Main game loop - runs every tick
const matchLoop: nkruntime.MatchLoopFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  messages: nkruntime.MatchMessage[]
): { state: nkruntime.MatchState } | null {

  const gameState = state as GameState;

  // Don't process if game is not playing
  if (gameState.status !== 'playing') {
    return { state: gameState };
  }

  // Check timer for timed mode
  if (gameState.gameMode === 'timed' && gameState.turnTimeLimit > 0) {
    const elapsed = (Date.now() - gameState.turnStartTime) / 1000;

    if (elapsed >= gameState.turnTimeLimit) {
      // Current player loses due to timeout
      const winner: PlayerMark = gameState.currentTurn === 'X' ? 'O' : 'X';
      gameState.winner = winner;
      gameState.status = 'finished';

      logger.info(`Player ${gameState.currentTurn} timed out. ${winner} wins!`);

      // Update leaderboards
      updateLeaderboards(nk, logger, gameState);

      // Broadcast game over
      broadcastGameOver(dispatcher, gameState);

      return { state: gameState };
    }
  }

  // Process incoming messages (moves)
  for (const message of messages) {
    if (message.opCode !== OpCode.MOVE) {
      continue;
    }

    const senderId = message.sender.userId;

    // Validate it's the correct player's turn
    const isXTurn = gameState.currentTurn === 'X';
    const isValidPlayer = isXTurn
      ? senderId === gameState.players.xUserId
      : senderId === gameState.players.odUserId;

    if (!isValidPlayer) {
      logger.warn(`Invalid move: Not ${senderId}'s turn`);
      continue;
    }

    // Parse move
    let move: MoveMessage;
    try {
      move = JSON.parse(nk.binaryToString(message.data));
    } catch (e) {
      logger.warn('Invalid move data format');
      continue;
    }

    const cellIndex = move.cellIndex;

    // Validate cell index
    if (cellIndex < 0 || cellIndex > 8) {
      logger.warn(`Invalid cell index: ${cellIndex}`);
      continue;
    }

    // Validate cell is empty
    if (gameState.board[cellIndex] !== null) {
      logger.warn(`Cell ${cellIndex} is already occupied`);
      continue;
    }

    // Apply the move
    gameState.board[cellIndex] = gameState.currentTurn;
    gameState.moveCount++;

    logger.info(`Player ${gameState.currentTurn} placed at cell ${cellIndex}`);

    // Check for win
    const winResult = checkWin(gameState.board, gameState.currentTurn);

    if (winResult.won) {
      gameState.winner = gameState.currentTurn;
      gameState.winningCells = winResult.cells;
      gameState.status = 'finished';

      logger.info(`${gameState.currentTurn} wins!`);

      // Update leaderboards
      updateLeaderboards(nk, logger, gameState);

      // Broadcast game over
      broadcastGameOver(dispatcher, gameState);

      return { state: gameState };
    }

    // Check for draw
    if (gameState.moveCount >= 9) {
      gameState.winner = 'draw';
      gameState.status = 'finished';

      logger.info('Game ended in a draw');

      // Update leaderboards (record draw for both players)
      updateLeaderboards(nk, logger, gameState);

      // Broadcast game over
      broadcastGameOver(dispatcher, gameState);

      return { state: gameState };
    }

    // Switch turn
    gameState.currentTurn = gameState.currentTurn === 'X' ? 'O' : 'X';
    gameState.turnStartTime = Date.now();

    // Broadcast updated state
    broadcastState(dispatcher, gameState);
  }

  return { state: gameState };
};

// Handle player leaving
const matchLeave: nkruntime.MatchLeaveFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {

  const gameState = state as GameState;

  for (const presence of presences) {
    logger.info(`Player ${presence.userId} left the match`);

    // If game is still playing, the remaining player wins
    if (gameState.status === 'playing') {
      if (presence.userId === gameState.players.xUserId) {
        gameState.winner = 'O';
      } else if (presence.userId === gameState.players.odUserId) {
        gameState.winner = 'X';
      }

      gameState.status = 'finished';

      // Update leaderboards
      updateLeaderboards(nk, logger, gameState);

      // Notify remaining player
      const leftMessage = JSON.stringify({ playerLeft: true, winner: gameState.winner });
      dispatcher.broadcastMessage(OpCode.PLAYER_LEFT, leftMessage);

      logger.info(`Player left - ${gameState.winner} wins by default`);
    }
  }

  // Check if match should be terminated
  const remainingPlayers =
    (gameState.players.xUserId && !presences.some(p => p.userId === gameState.players.xUserId) ? 1 : 0) +
    (gameState.players.odUserId && !presences.some(p => p.userId === gameState.players.odUserId) ? 1 : 0);

  if (remainingPlayers === 0 || gameState.status === 'finished') {
    // End the match
    return null;
  }

  return { state: gameState };
};

// Handle match termination
const matchTerminate: nkruntime.MatchTerminateFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  graceSeconds: number
): { state: nkruntime.MatchState } | null {

  logger.info('Match terminated');
  return null;
};

// Handle match signal (for external communication)
const matchSignal: nkruntime.MatchSignalFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  data: string
): { state: nkruntime.MatchState; data?: string } | null {

  logger.debug(`Match signal received: ${data}`);
  return { state };
};

// Helper: Check for win
function checkWin(board: (string | null)[], player: string): { won: boolean; cells: number[] } {
  for (const pattern of WIN_PATTERNS) {
    if (
      board[pattern[0]] === player &&
      board[pattern[1]] === player &&
      board[pattern[2]] === player
    ) {
      return { won: true, cells: pattern };
    }
  }
  return { won: false, cells: [] };
}

// Helper: Broadcast game state
function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: GameState): void {
  const stateJson = JSON.stringify({
    board: state.board,
    currentTurn: state.currentTurn,
    status: state.status,
    players: {
      x: { name: state.players.xName, odId: state.players.xUserId },
      od: { name: state.players.odName, odId: state.players.odUserId }
    },
    gameMode: state.gameMode,
    turnTimeLimit: state.turnTimeLimit,
    turnStartTime: state.turnStartTime
  });

  dispatcher.broadcastMessage(OpCode.STATE_UPDATE, stateJson);
}

// Helper: Broadcast game over
function broadcastGameOver(dispatcher: nkruntime.MatchDispatcher, state: GameState): void {
  const gameOverJson = JSON.stringify({
    winner: state.winner,
    winningCells: state.winningCells,
    board: state.board,
    players: {
      x: { name: state.players.xName, odId: state.players.xUserId },
      od: { name: state.players.odName, odId: state.players.odUserId }
    }
  });

  dispatcher.broadcastMessage(OpCode.GAME_OVER, gameOverJson);
}

// Helper: Update leaderboards
function updateLeaderboards(nk: nkruntime.Nakama, logger: nkruntime.Logger, state: GameState): void {
  if (!state.winner) {
    return;
  }

  try {
    const xUserId = state.players.xUserId;
    const xName = state.players.xName;
    const oUserId = state.players.odUserId;
    const oName = state.players.odName;

    if (state.winner === 'draw') {
      // Increment draws for both players
      nk.leaderboardRecordWrite(LEADERBOARD_DRAWS, xUserId, xName, 1, 0);
      nk.leaderboardRecordWrite(LEADERBOARD_DRAWS, oUserId, oName, 1, 0);

      // Reset streaks for both players on draw (using 'set' operator)
      nk.leaderboardRecordWrite(LEADERBOARD_STREAK, xUserId, xName, 0, 0);
      nk.leaderboardRecordWrite(LEADERBOARD_STREAK, oUserId, oName, 0, 0);

      logger.info(`Draw recorded for ${xName} and ${oName}, both streaks reset to 0`);
      return;
    }

    // Determine winner and loser
    const winnerId = state.winner === 'X' ? xUserId : oUserId;
    const winnerName = state.winner === 'X' ? xName : oName;
    const loserId = state.winner === 'X' ? oUserId : xUserId;
    const loserName = state.winner === 'X' ? oName : xName;

    // Increment wins for winner
    nk.leaderboardRecordWrite(LEADERBOARD_WINS, winnerId, winnerName, 1, 0);

    // Increment losses for loser
    nk.leaderboardRecordWrite(LEADERBOARD_LOSSES, loserId, loserName, 1, 0);

    // Update winner's streak (increment by 1)
    // Fetch winner's current streak - use limit 100 and find by ownerId to avoid Nakama filtering issues
    const winnerStreakRecords = nk.leaderboardRecordsList(LEADERBOARD_STREAK, [winnerId], 100);
    let previousStreak = 0;
    if (winnerStreakRecords.records) {
      for (const record of winnerStreakRecords.records) {
        if (record.ownerId === winnerId) {
          previousStreak = record.score;
          break;
        }
      }
    }
    const newStreak = previousStreak + 1;
    nk.leaderboardRecordWrite(LEADERBOARD_STREAK, winnerId, winnerName, newStreak, 0);

    // Reset loser's streak to 0 (using 'set' operator, so this will always work)
    nk.leaderboardRecordWrite(LEADERBOARD_STREAK, loserId, loserName, 0, 0);

    logger.info(`Updated leaderboards: ${winnerName} wins +1 (streak: ${previousStreak} -> ${newStreak}), ${loserName} streak reset to 0`);
  } catch (e) {
    logger.error(`Failed to update leaderboards: ${e}`);
  }
}

// Export match handler functions
export const matchHandler: nkruntime.MatchHandler = {
  matchInit,
  matchJoinAttempt,
  matchJoin,
  matchLoop,
  matchLeave,
  matchTerminate,
  matchSignal
};
