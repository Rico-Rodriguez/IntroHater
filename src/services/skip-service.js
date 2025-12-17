const fs = require('fs').promises;
const path = require('path');
const mongoService = require('./mongodb');
const axios = require('axios');

const DATA_FILE = path.join(__dirname, '../data/skips.json');

// In-memory cache (Fallback)
let skipsData = {}; // Format: { "imdb:s:e": [ { start, end, label, votes } ] }

// Initialize
let initPromise = null;

function ensureInit() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            console.log('[SkipService] Initializing...');
            skipsCollection = await mongoService.getCollection('skips');

            if (skipsCollection) {
                useMongo = true;
                console.log('[SkipService] Connected to MongoDB.');
                try {
                    await skipsCollection.createIndex({ fullId: 1 }, { unique: true });
                } catch (e) { /* Index might already exist */ }
            } else {
                console.log('[SkipService] MongoDB not available. Using local JSON.');
                await loadSkips();
            }
        } catch (e) {
            console.error("[SkipService] Init Error:", e);
            await loadSkips();
        }
    })();

    return initPromise;
}

// Trigger early
ensureInit();

async function loadSkips() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        skipsData = JSON.parse(data);
        console.log(`[SkipService] Loaded ${Object.keys(skipsData).length} shows from local DB.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            skipsData = {};
        } else {
            console.error('[SkipService] Error loading data:', error);
        }
    }
}

async function saveSkips() {
    try {
        const dir = path.dirname(DATA_FILE);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(DATA_FILE, JSON.stringify(skipsData, null, 4));
    } catch (error) {
        console.error('[SkipService] Error saving data:', error);
    }
}

// --- Helpers ---

// Get all segments for a specific video ID
async function getSegments(fullId) {
    await ensureInit();

    if (useMongo && skipsCollection) {
        try {
            const cleanId = String(fullId).trim();
            const doc = await skipsCollection.findOne({ fullId: cleanId });

            if (doc) {
                console.log(`[SkipService] Found ${doc.segments.length} segments in Mongo for [${cleanId}]`);
                return doc.segments;
            } else {
                console.log(`[SkipService] No segments found in Mongo for [${cleanId}]`);
                return [];
            }
        } catch (e) {
            console.error("[SkipService] Mongo Query Error:", e.message);
            return [];
        }
    }
    return skipsData[fullId] || [];
}

// Get all skips (Heavy operation - used for catalog)
async function getAllSegments() {
    if (useMongo) {
        // Return object map key->segments to match original API
        const allDocs = await skipsCollection.find({}).toArray();
        const map = {};
        allDocs.forEach(d => map[d.fullId] = d.segments);
        return map;
    }
    return skipsData;
}

// --- Aniskip Integration ---

async function getMalId(imdbId) {
    if (MAL_CACHE[imdbId]) return MAL_CACHE[imdbId];

    try {
        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
        const name = metaRes.data?.meta?.name;
        if (!name) return null;

        console.log(`[SkipService] Searching MAL ID for "${name}"...`);
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&type=tv&limit=1`);

        if (jikanRes.data?.data?.[0]?.mal_id) {
            const malId = jikanRes.data.data[0].mal_id;
            console.log(`[SkipService] Mapped ${imdbId} (${name}) -> MAL ${malId}`);
            MAL_CACHE[imdbId] = malId;
            return malId;
        }
    } catch (e) {
        console.error(`[SkipService] Mapping failed for ${imdbId}: ${e.message}`);
    }
    return null;
}

async function fetchAniskip(malId, episode) {
    try {
        const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types[]=op&types[]=ed&episodeLength=0`;
        const res = await axios.get(url);
        if (res.data.found && res.data.results) {
            const op = res.data.results.find(r => r.skipType === 'op');
            if (op && op.interval) {
                return {
                    start: op.interval.startTime,
                    end: op.interval.endTime,
                    label: 'Intro',
                    source: 'aniskip'
                };
            }
        }
    } catch (e) { }
    return null;
}


// --- Main Lookup Logic ---

async function getSkipSegment(fullId) {
    // 1. Check DB (Local or Mongo)
    const segments = await getSegments(fullId);
    if (segments && segments.length > 0) {
        // Find best intro
        const intro = segments.find(s => s.label === 'Intro' || s.label === 'OP');
        if (intro) {
            return { start: intro.start, end: intro.end };
        }
    }

    // 2. Parsed ID Check for Aniskip fallback
    const parts = fullId.split(':');
    if (parts.length >= 3) {
        const imdbId = parts[0];
        const episode = parseInt(parts[2]);

        // 3. Try Aniskip
        const malId = await getMalId(imdbId);
        if (malId) {
            const aniSkip = await fetchAniskip(malId, episode);
            if (aniSkip) {
                console.log(`[SkipService] Found Aniskip for ${fullId}: ${aniSkip.start}-${aniSkip.end}`);
                return aniSkip; // Don't save to DB yet to keep DB clean, just returning it dynamically
            }
        }
    }

    return null;
}

// --- Write Operations (Crowdsourcing) ---

async function addSkipSegment(fullId, start, end, label = "Intro", userId = "anonymous") {
    const newSegment = {
        start, end, label,
        votes: 1,
        verified: false, // All new submissions start unverified
        reportCount: 0,
        contributors: [userId],
        createdAt: new Date().toISOString()
    };

    if (useMongo) {
        await skipsCollection.updateOne(
            { fullId },
            { $push: { segments: newSegment } },
            { upsert: true }
        );
    } else {
        if (!skipsData[fullId]) skipsData[fullId] = [];
        skipsData[fullId].push(newSegment);
        await saveSkips();
    }
    return newSegment;
}

// --- Admin Operations ---

async function getPendingModeration() {
    const allSkips = await getAllSegments();
    const pending = [];
    const reported = [];

    for (const [fullId, segments] of Object.entries(allSkips)) {
        segments.forEach((seg, index) => {
            if (!seg.verified) {
                pending.push({ fullId, index, ...seg });
            }
            if (seg.reportCount > 0) {
                reported.push({ fullId, index, ...seg });
            }
        });
    }

    return { pending, reported };
}

async function resolveModeration(fullId, index, action) {
    if (useMongo) {
        const doc = await skipsCollection.findOne({ fullId });
        if (!doc || !doc.segments[index]) return false;

        if (action === 'approve') {
            doc.segments[index].verified = true;
            doc.segments[index].reportCount = 0;
        } else if (action === 'delete') {
            doc.segments.splice(index, 1);
        }

        await skipsCollection.updateOne({ fullId }, { $set: { segments: doc.segments } });
    } else {
        if (!skipsData[fullId] || !skipsData[fullId][index]) return false;

        if (action === 'approve') {
            skipsData[fullId][index].verified = true;
            skipsData[fullId][index].reportCount = 0;
        } else if (action === 'delete') {
            skipsData[fullId].splice(index, 1);
        }
        await saveSkips();
    }
    return true;
}

async function reportSegment(fullId, index) {
    if (useMongo) {
        const doc = await skipsCollection.findOne({ fullId });
        if (!doc || !doc.segments[index]) return false;
        doc.segments[index].reportCount = (doc.segments[index].reportCount || 0) + 1;
        await skipsCollection.updateOne({ fullId }, { $set: { segments: doc.segments } });
    } else {
        if (!skipsData[fullId] || !skipsData[fullId][index]) return false;
        skipsData[fullId][index].reportCount = (skipsData[fullId][index].reportCount || 0) + 1;
        await saveSkips();
    }
    return true;
}

module.exports = {
    getSkipSegment,
    getSegments,
    getAllSegments,
    addSkipSegment,
    getPendingModeration,
    resolveModeration,
    reportSegment
};
