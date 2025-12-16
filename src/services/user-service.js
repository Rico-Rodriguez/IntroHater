const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/users.json');

// In-memory cache
let usersData = {
    stats: [],
    tokens: []
};

// Initialize by reading file
async function loadUsers() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        usersData = JSON.parse(data);
        console.log(`[Users] Loaded ${usersData.stats.length} stats and ${usersData.tokens.length} tokens.`);
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
        await fs.writeFile(DATA_FILE, JSON.stringify(usersData, null, 4));
    } catch (error) {
        console.error('[Users] Error saving data:', error);
    }
}

// --- Stats Operations ---

function getUserStats(userId) {
    return usersData.stats.find(s => s.userId === userId) || null;
}

async function updateUserStats(userId, updates) {
    let stats = getUserStats(userId);
    if (!stats) {
        stats = { userId, segments: 0, votes: 0, lastUpdated: new Date().toISOString() };
        usersData.stats.push(stats);
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
            // Fallback for non-video votes (if any)
            stats.votes = (stats.votes || 0) + updates.votes;
        }

        delete updates.votes;
        delete updates.videoId;
    }

    Object.assign(stats, updates);
    stats.lastUpdated = new Date().toISOString();

    await saveUsers();
    return stats;
}

function getLeaderboard(limit = 10) {
    return usersData.stats
        .sort((a, b) => {
            // Sort by Votes (primary) + Segments (secondary/legacy)
            // Or just Votes since that's the active metric for Lite
            const votesA = a.votes || 0;
            const votesB = b.votes || 0;
            if (votesB !== votesA) return votesB - votesA;
            return (b.segments || 0) - (a.segments || 0);
        })
        .slice(0, limit);
}

function getStats() {
    const userCount = usersData.stats.length;
    const voteCount = usersData.stats.reduce((sum, user) => sum + (user.votes || 0), 0);
    return { userCount, voteCount };
}

// --- Token Operations ---

function getUserToken(userId) {
    return usersData.tokens.find(t => t.userId === userId) || null;
}

async function storeUserToken(userId, token, timestamp, nonce) {
    let tokenEntry = getUserToken(userId);

    const entry = {
        userId,
        token,
        timestamp,
        nonce,
        createdAt: tokenEntry ? tokenEntry.createdAt : new Date().toISOString(),
        lastUsed: new Date().toISOString()
    };

    if (tokenEntry) {
        Object.assign(tokenEntry, entry);
    } else {
        usersData.tokens.push(entry);
    }

    await saveUsers();
    return entry;
}

// Initial load
loadUsers();

module.exports = {
    getUserStats,
    updateUserStats,
    getLeaderboard,
    getStats,
    getUserToken,
    storeUserToken
};
