const fs = require('fs');
const path = require('path');

let skips = {};
try {
    const dataPath = path.join(__dirname, '../data/skips.json');
    if (fs.existsSync(dataPath)) {
        skips = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        console.log(`[SkipService] Loaded ${Object.keys(skips).length} shows from local DB.`);
    }
} catch (e) {
    console.error(`[SkipService] Failed to load skips: ${e.message}`);
}

function getSkipSegment(fullId) {
    // fullId example: tt0944947:2:2
    const segments = skips[fullId];
    if (segments && segments.length > 0) {
        // Find intro
        const intro = segments.find(s => s.label === 'Intro' || s.label === 'OP');
        if (intro) {
            console.log(`[SkipService] Found skip for ${fullId}: ${intro.start}-${intro.end}s`);
            return {
                start: intro.start,
                end: intro.end
            };
        }
    }
    return null;
}

// --- Aniskip Integration ---
const axios = require('axios');
const MAL_CACHE = {};

async function getMalId(imdbId) {
    if (MAL_CACHE[imdbId]) return MAL_CACHE[imdbId];

    try {
        // 1. Get Name from Cinemeta
        const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
        const name = metaRes.data?.meta?.name;
        if (!name) return null;

        console.log(`[SkipService] Searching MAL ID for "${name}"...`);

        // 2. Search Jikan (Anime DB)
        // We use a small delay or retry if rate limited, but for now simple fetch
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
                    label: 'Intro'
                };
            }
        }
    } catch (e) {
        // console.error(`[SkipService] Aniskip failed: ${e.message}`);
    }
    return null;
}

// Async Wrapper for Main Logic
async function getSkipSegmentAsync(fullId) {
    // 1. Check Local DB First
    const local = getSkipSegment(fullId);
    if (local) return local;

    // 2. Parsed ID
    const parts = fullId.split(':');
    if (parts.length < 3) return null; // Not a series or invalid

    const imdbId = parts[0];
    const episode = parseInt(parts[2]);

    // 3. Try Aniskip
    const malId = await getMalId(imdbId);
    if (malId) {
        const aniSkip = await fetchAniskip(malId, episode);
        if (aniSkip) {
            console.log(`[SkipService] Found Aniskip for ${fullId}: ${aniSkip.start}-${aniSkip.end}`);
            return aniSkip;
        }
    }

    return null;
}

// Export the async version as the primary one for server_lite

// Restored Helpers
function getSegments(streamId) {
    return skips[streamId] || [];
}

function getAllSegments() {
    return skips;
}

// Export the async version as the primary one for server_lite
module.exports = {
    getSkipSegment: getSkipSegmentAsync, // Replacing the sync export with async
    getLocalSkipSegment: getSkipSegment, // Keep sync for reference if needed
    getSegments,
    getAllSegments
};
