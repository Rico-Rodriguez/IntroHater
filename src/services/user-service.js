const fs = require('fs').promises;
const path = require('path');
const mongoService = require('./mongodb');

const DATA_FILE = path.join(__dirname, '../data/users.json');

// In-memory cache (Fallback)
let usersData = {
    stats: [],
    tokens: []
};

// Persistence State
let useMongo = false;
let usersCollection = null;
let tokensCollection = null;

// Initialize
(async () => {
    try {
        usersCollection = await mongoService.getCollection('users');
        tokensCollection = await mongoService.getCollection('tokens');

        if (usersCollection) {
            useMongo = true;
            console.log('[Users] Using MongoDB for persistence.');
            // Ensure Indexes
            await usersCollection.createIndex({ userId: 1 }, { unique: true });
            await usersCollection.createIndex({ votes: -1, segments: -1 });  // Leaderboard index
            await tokensCollection.createIndex({ userId: 1 });
        } else {
            console.log('[Users] MongoDB not available. Using local JSON file (Ephemeral on Render).');
            await loadUsers();
        }
    } catch (e) {
        console.error("[Users] Init Error:", e);
        await loadUsers();
    }
})();

async function loadUsers() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        usersData = JSON.parse(data);
        console.log(`[Users] Loaded ${usersData.stats.length} stats and ${usersData.tokens.length} tokens from file.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Users] No users.json found, starting fresh.');
            await saveUsers();
        } else {
            console.error('[Users] Error loading data:', error);
        }
    }
}

async function saveUsers() {
    try {
        // Ensure directory exists
        const dir = path.dirname(DATA_FILE);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(DATA_FILE, JSON.stringify(usersData, null, 4));
    } catch (error) {
        console.error('[Users] Error saving data:', error);
    }
}

// --- Stats Operations ---

async function getUserStats(userId) {
    if (useMongo) {
        return await usersCollection.findOne({ userId });
    }
    return usersData.stats.find(s => s.userId === userId) || null;
}

async function addWatchHistory(userId, item) {
    let stats = await getUserStats(userId);
    if (!stats) {
        stats = { userId, segments: 0, votes: 0, votedVideos: [], watchHistory: [], lastUpdated: new Date().toISOString() };
    }

    if (!stats.watchHistory) stats.watchHistory = [];

    // Add to history (limit to last 50 items)
    // Check if we already have this video recently to avoid spam, but update timestamp
    const existingIndex = stats.watchHistory.findIndex(h => h.videoId === item.videoId);
    if (existingIndex > -1) {
        stats.watchHistory.splice(existingIndex, 1);
    }

    stats.watchHistory.unshift({
        ...item,
        timestamp: new Date().toISOString()
    });

    if (stats.watchHistory.length > 50) {
        stats.watchHistory = stats.watchHistory.slice(0, 50);
    }

    return await updateUserStats(userId, { watchHistory: stats.watchHistory });
}

async function updateUserStats(userId, updates) {
    let stats;

    if (useMongo) {
        stats = await usersCollection.findOne({ userId });
    } else {
        stats = usersData.stats.find(s => s.userId === userId);
    }

    if (!stats) {
        stats = { userId, segments: 0, votes: 0, votedVideos: [], lastUpdated: new Date().toISOString() };
        if (!useMongo) usersData.stats.push(stats);
    }

    // Apply updates - specific handling for votes increment
    if (updates.votes && typeof updates.votes === 'number') {
        const videoId = updates.videoId;

        // Initialize votedVideos set if missing
        if (!stats.votedVideos) stats.votedVideos = [];

        // Only increment if we haven't voted on this video yet
        if (videoId && !stats.votedVideos.includes(videoId)) {
            stats.votes = (stats.votes || 0) + updates.votes;
            stats.votedVideos.push(videoId);
        } else if (!videoId) {
            // Fallback for non-video votes
            stats.votes = (stats.votes || 0) + updates.votes;
        }

        delete updates.votes;
        delete updates.videoId;
    }

    // Apply other updates
    Object.assign(stats, updates);
    stats.lastUpdated = new Date().toISOString();

    if (useMongo) {
        // Remove _id to avoid immutable field error on updates if it crept in
        const { _id, ...cleanStats } = stats;
        await usersCollection.updateOne({ userId }, { $set: cleanStats }, { upsert: true });
    } else {
        await saveUsers();
    }

    return stats;
}

async function getLeaderboard(limit = 10) {
    if (useMongo) {
        // Return stats sorted by votes desc, then segments desc
        return await usersCollection.find()
            .sort({ votes: -1, segments: -1 })
            .limit(limit)
            .toArray();
    }

    return usersData.stats
        .sort((a, b) => {
            const votesA = a.votes || 0;
            const votesB = b.votes || 0;
            if (votesB !== votesA) return votesB - votesA;
            return (b.segments || 0) - (a.segments || 0);
        })
        .slice(0, limit);
}

async function getStats() {
    if (useMongo) {
        const userCount = await usersCollection.countDocuments();
        // Sum all votes
        const agg = await usersCollection.aggregate([
            { $group: { _id: null, totalVotes: { $sum: "$votes" } } }
        ]).toArray();
        const voteCount = agg[0] ? agg[0].totalVotes : 0;
        return { userCount, voteCount };
    }

    const userCount = usersData.stats.length;
    const voteCount = usersData.stats.reduce((sum, user) => sum + (user.votes || 0), 0);
    return { userCount, voteCount };
}

// --- Token Operations ---

async function getUserToken(userId) {
    if (useMongo) {
        return await tokensCollection.findOne({ userId });
    }
    return usersData.tokens.find(t => t.userId === userId) || null;
}

async function storeUserToken(userId, token, timestamp, nonce) {
    let entry = {
        userId,
        token,
        timestamp,
        nonce,
        lastUsed: new Date().toISOString()
    };

    if (useMongo) {
        const existing = await tokensCollection.findOne({ userId });
        entry.createdAt = existing ? existing.createdAt : new Date().toISOString();
        await tokensCollection.updateOne({ userId }, { $set: entry }, { upsert: true });
    } else {
        let tokenEntry = usersData.tokens.find(t => t.userId === userId);
        entry.createdAt = tokenEntry ? tokenEntry.createdAt : new Date().toISOString();

        if (tokenEntry) {
            Object.assign(tokenEntry, entry);
        } else {
            usersData.tokens.push(entry);
        }
        await saveUsers();
    }

    return entry;
}

module.exports = {
    getUserStats,
    updateUserStats,
    addWatchHistory,
    getLeaderboard,
    getStats,
    getUserToken,
    storeUserToken
};
