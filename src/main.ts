// Main entry point for Nakama TypeScript runtime
// LILA Games - Multiplayer Tic-Tac-Toe Server

import { matchHandler } from './match_handler';
import {
  LEADERBOARD_WINS,
  LEADERBOARD_LOSSES,
  LEADERBOARD_DRAWS,
  LEADERBOARD_STREAK,
  LEADERBOARD_WEEKLY
} from './types';

// RPC: Get player stats
const rpcGetPlayerStats: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;

  if (!userId) {
    throw new Error('User not authenticated');
  }

  try {
    // Get wins
    const winsRecords = nk.leaderboardRecordsList(LEADERBOARD_WINS, [userId], 1);
    const wins = winsRecords.records && winsRecords.records.length > 0
      ? winsRecords.records[0].score
      : 0;

    // Get streak
    const streakRecords = nk.leaderboardRecordsList(LEADERBOARD_STREAK, [userId], 1);
    const streak = streakRecords.records && streakRecords.records.length > 0
      ? streakRecords.records[0].score
      : 0;

    // Get weekly wins
    const weeklyRecords = nk.leaderboardRecordsList(LEADERBOARD_WEEKLY, [userId], 1);
    const weeklyWins = weeklyRecords.records && weeklyRecords.records.length > 0
      ? weeklyRecords.records[0].score
      : 0;

    return JSON.stringify({
      odId: userId,
      wins: wins,
      bestStreak: streak,
      weeklyWins: weeklyWins
    });

  } catch (e) {
    logger.error(`Error getting player stats: ${e}`);
    return JSON.stringify({ error: 'Failed to get stats' });
  }
};

// RPC: Get leaderboard
const rpcGetLeaderboard: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  try {
    const input = payload ? JSON.parse(payload) : {};
    const limit = input.limit || 10;

    // Get wins leaderboard (main ranking)
    const winsResult = nk.leaderboardRecordsList(LEADERBOARD_WINS, [], limit);
    const winsRecords = winsResult.records || [];

    if (winsRecords.length === 0) {
      return JSON.stringify({ records: [] });
    }

    // Get user IDs from wins leaderboard
    const userIds = winsRecords.map((r: nkruntime.LeaderboardRecord) => r.ownerId);

    // Fetch losses, draws, and streaks for these users
    const lossesResult = nk.leaderboardRecordsList(LEADERBOARD_LOSSES, userIds, limit);
    const drawsResult = nk.leaderboardRecordsList(LEADERBOARD_DRAWS, userIds, limit);
    const streakResult = nk.leaderboardRecordsList(LEADERBOARD_STREAK, userIds, limit);

    // Create maps for losses, draws, and streaks
    const lossesMap: { [key: string]: number } = {};
    const drawsMap: { [key: string]: number } = {};
    const streakMap: { [key: string]: number } = {};

    for (const r of (lossesResult.records || [])) {
      lossesMap[r.ownerId] = r.score;
    }
    for (const r of (drawsResult.records || [])) {
      drawsMap[r.ownerId] = r.score;
    }
    for (const r of (streakResult.records || [])) {
      streakMap[r.ownerId] = r.score;
    }

    // Fetch current user display names
    const users = nk.usersGetId(userIds);
    const userNameMap: { [key: string]: string } = {};
    for (const user of users) {
      userNameMap[user.userId] = user.displayName || user.username || `Player_${user.userId.substring(0, 6)}`;
    }

    return JSON.stringify({
      records: winsRecords.map((r: nkruntime.LeaderboardRecord) => ({
        odId: r.ownerId,
        username: userNameMap[r.ownerId] || r.username,
        wins: r.score,
        losses: lossesMap[r.ownerId] || 0,
        draws: drawsMap[r.ownerId] || 0,
        streak: streakMap[r.ownerId] || 0,
        rank: r.rank
      }))
    });

  } catch (e) {
    logger.error(`Error getting leaderboard: ${e}`);
    return JSON.stringify({ error: 'Failed to get leaderboard', records: [] });
  }
};

// RPC: Create a match (for direct match creation)
const rpcCreateMatch: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  try {
    const input = payload ? JSON.parse(payload) : {};
    const gameMode = input.mode || 'classic';

    const matchId = nk.matchCreate('tictactoe', { mode: gameMode });

    logger.info(`Match created: ${matchId} with mode: ${gameMode}`);

    return JSON.stringify({ matchId: matchId });

  } catch (e) {
    logger.error(`Error creating match: ${e}`);
    throw new Error('Failed to create match');
  }
};

// Matchmaker matched callback - creates a match when players are paired
const matchmakerMatched: nkruntime.MatchmakerMatchedFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  matches: nkruntime.MatchmakerResult[]
): string | void {

  if (matches.length < 2) {
    logger.warn('Not enough players matched');
    return;
  }

  // Get game mode from first player's properties
  const gameMode = matches[0].properties?.gameMode || 'classic';

  // Create the match
  const matchId = nk.matchCreate('tictactoe', { mode: gameMode });

  logger.info(`Matchmaker created match: ${matchId} for ${matches.length} players`);

  return matchId;
};

// Storage key for tracking active session
const SESSION_STORAGE_COLLECTION = 'active_sessions';
const SESSION_STORAGE_KEY = 'current_session';

// After authenticate hook - enforces single session per user
const afterAuthenticateDevice: nkruntime.AfterHookFunction<nkruntime.Session, nkruntime.AuthenticateDeviceRequest> = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  data: nkruntime.Session,
  request: nkruntime.AuthenticateDeviceRequest
): void {
  const userId = ctx.userId;
  const currentSessionId = ctx.sessionId;

  if (!userId || !currentSessionId) {
    logger.warn('No userId or sessionId in context');
    return;
  }

  logger.info(`After auth hook triggered for user ${userId}, session ${currentSessionId}`);

  try {
    // Try to read the previous session ID from storage
    const existingSession = nk.storageRead([{
      collection: SESSION_STORAGE_COLLECTION,
      key: SESSION_STORAGE_KEY,
      userId: userId
    }]);

    logger.info(`Found ${existingSession?.length || 0} existing session records`);

    if (existingSession && existingSession.length > 0) {
      const oldSessionId = existingSession[0].value.sessionId as string;
      logger.info(`Old session ID: ${oldSessionId}, Current: ${currentSessionId}`);

      // If there's an old session and it's different from current, disconnect it
      if (oldSessionId && oldSessionId !== currentSessionId) {
        logger.info(`Disconnecting old session ${oldSessionId} for user ${userId}`);
        try {
          nk.sessionDisconnect(oldSessionId, false);
          logger.info(`Successfully disconnected old session`);
        } catch (e) {
          // Session might already be disconnected
          logger.warn(`Could not disconnect old session: ${e}`);
        }
      } else {
        logger.info('Same session or no old session to disconnect');
      }
    }

    // Store the current session ID
    nk.storageWrite([{
      collection: SESSION_STORAGE_COLLECTION,
      key: SESSION_STORAGE_KEY,
      userId: userId,
      value: { sessionId: currentSessionId, timestamp: Date.now() },
      permissionRead: 1, // Owner can read
      permissionWrite: 0 // Only server can write
    }]);

    logger.info(`Stored new session ${currentSessionId} for user ${userId}`);
  } catch (e) {
    logger.error(`Failed to manage sessions: ${e}`);
  }
};

// Module initialization - called when Nakama server starts
const InitModule: nkruntime.InitModule = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
) {
  logger.info('LILA Tic-Tac-Toe server initializing...');

  // Register the match handler
  initializer.registerMatch('tictactoe', matchHandler);
  logger.info('Match handler "tictactoe" registered');

  // Create leaderboards
  try {
    // Global wins leaderboard (authoritative, descending, incremental)
    nk.leaderboardCreate(
      LEADERBOARD_WINS,
      true,  // authoritative
      'desc',  // sortOrder
      'incr'   // operator
    );
    logger.info(`Leaderboard "${LEADERBOARD_WINS}" created`);

    // Global losses leaderboard (authoritative, descending, incremental)
    nk.leaderboardCreate(
      LEADERBOARD_LOSSES,
      true,
      'desc',
      'incr'
    );
    logger.info(`Leaderboard "${LEADERBOARD_LOSSES}" created`);

    // Global draws leaderboard (authoritative, descending, incremental)
    nk.leaderboardCreate(
      LEADERBOARD_DRAWS,
      true,
      'desc',
      'incr'
    );
    logger.info(`Leaderboard "${LEADERBOARD_DRAWS}" created`);

    // Current streak leaderboard (authoritative, descending, set - allows reset to 0)
    nk.leaderboardCreate(
      LEADERBOARD_STREAK,
      true,
      'desc',
      'set'  // Changed from 'best' to 'set' so we can reset streak to 0 on loss
    );
    logger.info(`Leaderboard "${LEADERBOARD_STREAK}" created`);

    // Weekly wins leaderboard (authoritative, descending, incremental, reset weekly)
    nk.leaderboardCreate(
      LEADERBOARD_WEEKLY,
      true,
      'desc',
      'incr',
      '0 0 * * 0' // Reset every Sunday at midnight
    );
    logger.info(`Leaderboard "${LEADERBOARD_WEEKLY}" created`);

  } catch (e) {
    // Leaderboards may already exist, which is fine
    logger.debug(`Leaderboard creation info: ${e}`);
  }

  // Register RPC functions
  initializer.registerRpc('get_player_stats', rpcGetPlayerStats);
  logger.info('RPC "get_player_stats" registered');

  initializer.registerRpc('get_leaderboard', rpcGetLeaderboard);
  logger.info('RPC "get_leaderboard" registered');

  initializer.registerRpc('create_match', rpcCreateMatch);
  logger.info('RPC "create_match" registered');

  // Register matchmaker matched callback
  initializer.registerMatchmakerMatched(matchmakerMatched);
  logger.info('Matchmaker callback registered');

  // Register after authenticate hook to enforce single session
  initializer.registerAfterAuthenticateDevice(afterAuthenticateDevice);
  logger.info('After authenticate device hook registered');

  logger.info('LILA Tic-Tac-Toe server initialized successfully!');
};

// Make InitModule global for Nakama runtime
(globalThis as any).InitModule = InitModule;
