'use strict';

// Game Types for Tic-Tac-Toe
// Op Codes for real-time messages
var OpCode;
(function (OpCode) {
    OpCode[OpCode["MOVE"] = 1] = "MOVE";
    OpCode[OpCode["STATE_UPDATE"] = 2] = "STATE_UPDATE";
    OpCode[OpCode["GAME_OVER"] = 3] = "GAME_OVER";
    OpCode[OpCode["TIMER_SYNC"] = 4] = "TIMER_SYNC";
    OpCode[OpCode["PLAYER_LEFT"] = 5] = "PLAYER_LEFT";
    OpCode[OpCode["READY"] = 6] = "READY";
})(OpCode || (OpCode = {}));
// Win patterns for Tic-Tac-Toe
var WIN_PATTERNS = [
    [0, 1, 2], // Top row
    [3, 4, 5], // Middle row
    [6, 7, 8], // Bottom row
    [0, 3, 6], // Left column
    [1, 4, 7], // Middle column
    [2, 5, 8], // Right column
    [0, 4, 8], // Diagonal top-left to bottom-right
    [2, 4, 6] // Diagonal top-right to bottom-left
];
// Leaderboard IDs
var LEADERBOARD_WINS = 'global_wins';
var LEADERBOARD_LOSSES = 'global_losses';
var LEADERBOARD_DRAWS = 'global_draws';
var LEADERBOARD_STREAK = 'global_streak';
var LEADERBOARD_WEEKLY = 'weekly_wins';
// Match constants
var MATCH_TICK_RATE = 2; // 2 ticks per second
var TIMED_MODE_TURN_LIMIT = 30; // 30 seconds per turn
var CLASSIC_MODE_TURN_LIMIT = 0; // No limit

// Server-Authoritative Match Handler for Tic-Tac-Toe
// Initialize a new match
var matchInit = function (ctx, logger, nk, params) {
    var gameMode = (params === null || params === void 0 ? void 0 : params.mode) || 'classic';
    var turnTimeLimit = gameMode === 'timed' ? TIMED_MODE_TURN_LIMIT : CLASSIC_MODE_TURN_LIMIT;
    var state = {
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
    var label = {
        open: true,
        gameMode: gameMode
    };
    logger.info("Match initialized with mode: ".concat(gameMode));
    return {
        state: state,
        tickRate: MATCH_TICK_RATE,
        label: JSON.stringify(label)
    };
};
// Handle join attempt
var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    var gameState = state;
    // Check if match is already full
    var playerCount = (gameState.players.xUserId ? 1 : 0) + (gameState.players.odUserId ? 1 : 0);
    if (playerCount >= 2) {
        logger.warn("Rejecting player ".concat(presence.userId, " - match is full"));
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
    logger.info("Player ".concat(presence.userId, " attempting to join"));
    return {
        state: gameState,
        accept: true
    };
};
// Handle player joining
var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var gameState = state;
    for (var _i = 0, presences_1 = presences; _i < presences_1.length; _i++) {
        var presence = presences_1[_i];
        // Get user account for display name (prefer displayName, fallback to username)
        var users = nk.usersGetId([presence.userId]);
        var user = users.length > 0 ? users[0] : null;
        var displayName = (user === null || user === void 0 ? void 0 : user.displayName) || (user === null || user === void 0 ? void 0 : user.username) || "Player_".concat(presence.userId.substring(0, 6));
        // Assign player to X or O
        if (!gameState.players.xUserId) {
            gameState.players.xUserId = presence.userId;
            gameState.players.xName = displayName;
            gameState.players.xSessionId = presence.sessionId;
            logger.info("Player ".concat(displayName, " joined as X"));
        }
        else if (!gameState.players.odUserId) {
            gameState.players.odUserId = presence.userId;
            gameState.players.odName = displayName;
            gameState.players.odSessionId = presence.sessionId;
            logger.info("Player ".concat(displayName, " joined as O"));
        }
    }
    // Check if we have 2 players to start the game
    if (gameState.players.xUserId && gameState.players.odUserId) {
        gameState.status = 'playing';
        gameState.turnStartTime = Date.now();
        // Update label to show match is no longer open
        var label = {
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
var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
    var gameState = state;
    // Don't process if game is not playing
    if (gameState.status !== 'playing') {
        return { state: gameState };
    }
    // Check timer for timed mode
    if (gameState.gameMode === 'timed' && gameState.turnTimeLimit > 0) {
        var elapsed = (Date.now() - gameState.turnStartTime) / 1000;
        if (elapsed >= gameState.turnTimeLimit) {
            // Current player loses due to timeout
            var winner = gameState.currentTurn === 'X' ? 'O' : 'X';
            gameState.winner = winner;
            gameState.status = 'finished';
            logger.info("Player ".concat(gameState.currentTurn, " timed out. ").concat(winner, " wins!"));
            // Update leaderboards
            updateLeaderboards(nk, logger, gameState);
            // Broadcast game over
            broadcastGameOver(dispatcher, gameState);
            return { state: gameState };
        }
    }
    // Process incoming messages (moves)
    for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
        var message = messages_1[_i];
        if (message.opCode !== OpCode.MOVE) {
            continue;
        }
        var senderId = message.sender.userId;
        // Validate it's the correct player's turn
        var isXTurn = gameState.currentTurn === 'X';
        var isValidPlayer = isXTurn
            ? senderId === gameState.players.xUserId
            : senderId === gameState.players.odUserId;
        if (!isValidPlayer) {
            logger.warn("Invalid move: Not ".concat(senderId, "'s turn"));
            continue;
        }
        // Parse move
        var move = void 0;
        try {
            move = JSON.parse(nk.binaryToString(message.data));
        }
        catch (e) {
            logger.warn('Invalid move data format');
            continue;
        }
        var cellIndex = move.cellIndex;
        // Validate cell index
        if (cellIndex < 0 || cellIndex > 8) {
            logger.warn("Invalid cell index: ".concat(cellIndex));
            continue;
        }
        // Validate cell is empty
        if (gameState.board[cellIndex] !== null) {
            logger.warn("Cell ".concat(cellIndex, " is already occupied"));
            continue;
        }
        // Apply the move
        gameState.board[cellIndex] = gameState.currentTurn;
        gameState.moveCount++;
        logger.info("Player ".concat(gameState.currentTurn, " placed at cell ").concat(cellIndex));
        // Check for win
        var winResult = checkWin(gameState.board, gameState.currentTurn);
        if (winResult.won) {
            gameState.winner = gameState.currentTurn;
            gameState.winningCells = winResult.cells;
            gameState.status = 'finished';
            logger.info("".concat(gameState.currentTurn, " wins!"));
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
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var gameState = state;
    for (var _i = 0, presences_2 = presences; _i < presences_2.length; _i++) {
        var presence = presences_2[_i];
        logger.info("Player ".concat(presence.userId, " left the match"));
        // If game is still playing, the remaining player wins
        if (gameState.status === 'playing') {
            if (presence.userId === gameState.players.xUserId) {
                gameState.winner = 'O';
            }
            else if (presence.userId === gameState.players.odUserId) {
                gameState.winner = 'X';
            }
            gameState.status = 'finished';
            // Update leaderboards
            updateLeaderboards(nk, logger, gameState);
            // Notify remaining player
            var leftMessage = JSON.stringify({ playerLeft: true, winner: gameState.winner });
            dispatcher.broadcastMessage(OpCode.PLAYER_LEFT, leftMessage);
            logger.info("Player left - ".concat(gameState.winner, " wins by default"));
        }
    }
    // Check if match should be terminated
    var remainingPlayers = (gameState.players.xUserId && !presences.some(function (p) { return p.userId === gameState.players.xUserId; }) ? 1 : 0) +
        (gameState.players.odUserId && !presences.some(function (p) { return p.userId === gameState.players.odUserId; }) ? 1 : 0);
    if (remainingPlayers === 0 || gameState.status === 'finished') {
        // End the match
        return null;
    }
    return { state: gameState };
};
// Handle match termination
var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    logger.info('Match terminated');
    return null;
};
// Handle match signal (for external communication)
var matchSignal = function (ctx, logger, nk, dispatcher, tick, state, data) {
    logger.debug("Match signal received: ".concat(data));
    return { state: state };
};
// Helper: Check for win
function checkWin(board, player) {
    for (var _i = 0, WIN_PATTERNS_1 = WIN_PATTERNS; _i < WIN_PATTERNS_1.length; _i++) {
        var pattern = WIN_PATTERNS_1[_i];
        if (board[pattern[0]] === player &&
            board[pattern[1]] === player &&
            board[pattern[2]] === player) {
            return { won: true, cells: pattern };
        }
    }
    return { won: false, cells: [] };
}
// Helper: Broadcast game state
function broadcastState(dispatcher, state) {
    var stateJson = JSON.stringify({
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
function broadcastGameOver(dispatcher, state) {
    var gameOverJson = JSON.stringify({
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
function updateLeaderboards(nk, logger, state) {
    if (!state.winner) {
        return;
    }
    try {
        var xUserId = state.players.xUserId;
        var xName = state.players.xName;
        var oUserId = state.players.odUserId;
        var oName = state.players.odName;
        if (state.winner === 'draw') {
            // Increment draws for both players
            nk.leaderboardRecordWrite(LEADERBOARD_DRAWS, xUserId, xName, 1, 0);
            nk.leaderboardRecordWrite(LEADERBOARD_DRAWS, oUserId, oName, 1, 0);
            // Reset streaks for both players on draw (using 'set' operator)
            nk.leaderboardRecordWrite(LEADERBOARD_STREAK, xUserId, xName, 0, 0);
            nk.leaderboardRecordWrite(LEADERBOARD_STREAK, oUserId, oName, 0, 0);
            logger.info("Draw recorded for ".concat(xName, " and ").concat(oName, ", both streaks reset to 0"));
            return;
        }
        // Determine winner and loser
        var winnerId = state.winner === 'X' ? xUserId : oUserId;
        var winnerName = state.winner === 'X' ? xName : oName;
        var loserId = state.winner === 'X' ? oUserId : xUserId;
        var loserName = state.winner === 'X' ? oName : xName;
        // Increment wins for winner
        nk.leaderboardRecordWrite(LEADERBOARD_WINS, winnerId, winnerName, 1, 0);
        // Increment losses for loser
        nk.leaderboardRecordWrite(LEADERBOARD_LOSSES, loserId, loserName, 1, 0);
        // Update winner's streak (increment by 1)
        // Fetch winner's current streak - use limit 100 and find by ownerId to avoid Nakama filtering issues
        var winnerStreakRecords = nk.leaderboardRecordsList(LEADERBOARD_STREAK, [winnerId], 100);
        var previousStreak = 0;
        if (winnerStreakRecords.records) {
            for (var _i = 0, _a = winnerStreakRecords.records; _i < _a.length; _i++) {
                var record = _a[_i];
                if (record.ownerId === winnerId) {
                    previousStreak = record.score;
                    break;
                }
            }
        }
        var newStreak = previousStreak + 1;
        nk.leaderboardRecordWrite(LEADERBOARD_STREAK, winnerId, winnerName, newStreak, 0);
        // Reset loser's streak to 0 (using 'set' operator, so this will always work)
        nk.leaderboardRecordWrite(LEADERBOARD_STREAK, loserId, loserName, 0, 0);
        logger.info("Updated leaderboards: ".concat(winnerName, " wins +1 (streak: ").concat(previousStreak, " -> ").concat(newStreak, "), ").concat(loserName, " streak reset to 0"));
    }
    catch (e) {
        logger.error("Failed to update leaderboards: ".concat(e));
    }
}
// Export match handler functions
var matchHandler = {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLoop: matchLoop,
    matchLeave: matchLeave,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
};

// Main entry point for Nakama TypeScript runtime
// LILA Games - Multiplayer Tic-Tac-Toe Server
// RPC: Get player stats
var rpcGetPlayerStats = function (ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        throw new Error('User not authenticated');
    }
    try {
        // Get wins
        var winsRecords = nk.leaderboardRecordsList(LEADERBOARD_WINS, [userId], 1);
        var wins = winsRecords.records && winsRecords.records.length > 0
            ? winsRecords.records[0].score
            : 0;
        // Get streak
        var streakRecords = nk.leaderboardRecordsList(LEADERBOARD_STREAK, [userId], 1);
        var streak = streakRecords.records && streakRecords.records.length > 0
            ? streakRecords.records[0].score
            : 0;
        // Get weekly wins
        var weeklyRecords = nk.leaderboardRecordsList(LEADERBOARD_WEEKLY, [userId], 1);
        var weeklyWins = weeklyRecords.records && weeklyRecords.records.length > 0
            ? weeklyRecords.records[0].score
            : 0;
        return JSON.stringify({
            odId: userId,
            wins: wins,
            bestStreak: streak,
            weeklyWins: weeklyWins
        });
    }
    catch (e) {
        logger.error("Error getting player stats: ".concat(e));
        return JSON.stringify({ error: 'Failed to get stats' });
    }
};
// RPC: Get leaderboard
var rpcGetLeaderboard = function (ctx, logger, nk, payload) {
    try {
        var input = payload ? JSON.parse(payload) : {};
        var limit = input.limit || 10;
        // Get wins leaderboard (main ranking)
        var winsResult = nk.leaderboardRecordsList(LEADERBOARD_WINS, [], limit);
        var winsRecords = winsResult.records || [];
        if (winsRecords.length === 0) {
            return JSON.stringify({ records: [] });
        }
        // Get user IDs from wins leaderboard
        var userIds = winsRecords.map(function (r) { return r.ownerId; });
        // Fetch losses, draws, and streaks for these users
        var lossesResult = nk.leaderboardRecordsList(LEADERBOARD_LOSSES, userIds, limit);
        var drawsResult = nk.leaderboardRecordsList(LEADERBOARD_DRAWS, userIds, limit);
        var streakResult = nk.leaderboardRecordsList(LEADERBOARD_STREAK, userIds, limit);
        // Create maps for losses, draws, and streaks
        var lossesMap_1 = {};
        var drawsMap_1 = {};
        var streakMap_1 = {};
        for (var _i = 0, _a = (lossesResult.records || []); _i < _a.length; _i++) {
            var r = _a[_i];
            lossesMap_1[r.ownerId] = r.score;
        }
        for (var _b = 0, _c = (drawsResult.records || []); _b < _c.length; _b++) {
            var r = _c[_b];
            drawsMap_1[r.ownerId] = r.score;
        }
        for (var _d = 0, _e = (streakResult.records || []); _d < _e.length; _d++) {
            var r = _e[_d];
            streakMap_1[r.ownerId] = r.score;
        }
        // Fetch current user display names
        var users = nk.usersGetId(userIds);
        var userNameMap_1 = {};
        for (var _f = 0, users_1 = users; _f < users_1.length; _f++) {
            var user = users_1[_f];
            userNameMap_1[user.userId] = user.displayName || user.username || "Player_".concat(user.userId.substring(0, 6));
        }
        return JSON.stringify({
            records: winsRecords.map(function (r) { return ({
                odId: r.ownerId,
                username: userNameMap_1[r.ownerId] || r.username,
                wins: r.score,
                losses: lossesMap_1[r.ownerId] || 0,
                draws: drawsMap_1[r.ownerId] || 0,
                streak: streakMap_1[r.ownerId] || 0,
                rank: r.rank
            }); })
        });
    }
    catch (e) {
        logger.error("Error getting leaderboard: ".concat(e));
        return JSON.stringify({ error: 'Failed to get leaderboard', records: [] });
    }
};
// RPC: Create a match (for direct match creation)
var rpcCreateMatch = function (ctx, logger, nk, payload) {
    try {
        var input = payload ? JSON.parse(payload) : {};
        var gameMode = input.mode || 'classic';
        var matchId = nk.matchCreate('tictactoe', { mode: gameMode });
        logger.info("Match created: ".concat(matchId, " with mode: ").concat(gameMode));
        return JSON.stringify({ matchId: matchId });
    }
    catch (e) {
        logger.error("Error creating match: ".concat(e));
        throw new Error('Failed to create match');
    }
};
// Matchmaker matched callback - creates a match when players are paired
var matchmakerMatched = function (ctx, logger, nk, matches) {
    var _a;
    if (matches.length < 2) {
        logger.warn('Not enough players matched');
        return;
    }
    // Get game mode from first player's properties
    var gameMode = ((_a = matches[0].properties) === null || _a === void 0 ? void 0 : _a.gameMode) || 'classic';
    // Create the match
    var matchId = nk.matchCreate('tictactoe', { mode: gameMode });
    logger.info("Matchmaker created match: ".concat(matchId, " for ").concat(matches.length, " players"));
    return matchId;
};
// Storage key for tracking active session
var SESSION_STORAGE_COLLECTION = 'active_sessions';
var SESSION_STORAGE_KEY = 'current_session';
// After authenticate hook - enforces single session per user
var afterAuthenticateDevice = function (ctx, logger, nk, data, request) {
    var userId = ctx.userId;
    var currentSessionId = ctx.sessionId;
    if (!userId || !currentSessionId) {
        logger.warn('No userId or sessionId in context');
        return;
    }
    logger.info("After auth hook triggered for user ".concat(userId, ", session ").concat(currentSessionId));
    try {
        // Try to read the previous session ID from storage
        var existingSession = nk.storageRead([{
                collection: SESSION_STORAGE_COLLECTION,
                key: SESSION_STORAGE_KEY,
                userId: userId
            }]);
        logger.info("Found ".concat((existingSession === null || existingSession === void 0 ? void 0 : existingSession.length) || 0, " existing session records"));
        if (existingSession && existingSession.length > 0) {
            var oldSessionId = existingSession[0].value.sessionId;
            logger.info("Old session ID: ".concat(oldSessionId, ", Current: ").concat(currentSessionId));
            // If there's an old session and it's different from current, disconnect it
            if (oldSessionId && oldSessionId !== currentSessionId) {
                logger.info("Disconnecting old session ".concat(oldSessionId, " for user ").concat(userId));
                try {
                    nk.sessionDisconnect(oldSessionId, false);
                    logger.info("Successfully disconnected old session");
                }
                catch (e) {
                    // Session might already be disconnected
                    logger.warn("Could not disconnect old session: ".concat(e));
                }
            }
            else {
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
        logger.info("Stored new session ".concat(currentSessionId, " for user ").concat(userId));
    }
    catch (e) {
        logger.error("Failed to manage sessions: ".concat(e));
    }
};
// Module initialization - called when Nakama server starts
var InitModule = function (ctx, logger, nk, initializer) {
    logger.info('LILA Tic-Tac-Toe server initializing...');
    // Register the match handler
    initializer.registerMatch('tictactoe', matchHandler);
    logger.info('Match handler "tictactoe" registered');
    // Create leaderboards
    try {
        // Global wins leaderboard (authoritative, descending, incremental)
        nk.leaderboardCreate(LEADERBOARD_WINS, true, // authoritative
        'desc', // sortOrder
        'incr' // operator
        );
        logger.info("Leaderboard \"".concat(LEADERBOARD_WINS, "\" created"));
        // Global losses leaderboard (authoritative, descending, incremental)
        nk.leaderboardCreate(LEADERBOARD_LOSSES, true, 'desc', 'incr');
        logger.info("Leaderboard \"".concat(LEADERBOARD_LOSSES, "\" created"));
        // Global draws leaderboard (authoritative, descending, incremental)
        nk.leaderboardCreate(LEADERBOARD_DRAWS, true, 'desc', 'incr');
        logger.info("Leaderboard \"".concat(LEADERBOARD_DRAWS, "\" created"));
        // Current streak leaderboard (authoritative, descending, set - allows reset to 0)
        nk.leaderboardCreate(LEADERBOARD_STREAK, true, 'desc', 'set' // Changed from 'best' to 'set' so we can reset streak to 0 on loss
        );
        logger.info("Leaderboard \"".concat(LEADERBOARD_STREAK, "\" created"));
        // Weekly wins leaderboard (authoritative, descending, incremental, reset weekly)
        nk.leaderboardCreate(LEADERBOARD_WEEKLY, true, 'desc', 'incr', '0 0 * * 0' // Reset every Sunday at midnight
        );
        logger.info("Leaderboard \"".concat(LEADERBOARD_WEEKLY, "\" created"));
    }
    catch (e) {
        // Leaderboards may already exist, which is fine
        logger.debug("Leaderboard creation info: ".concat(e));
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
globalThis.InitModule = InitModule;
