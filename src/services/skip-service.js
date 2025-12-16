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

// For API Use
function getSegments(streamId) {
    return skips[streamId] || [];
}

function getAllSegments() {
    return skips;
}

module.exports = {
    getSkipSegment,
    getSegments,
    getAllSegments
};
