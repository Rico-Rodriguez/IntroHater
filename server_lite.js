const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getByteOffset, generateSmartManifest, getStreamDetails, getRefinedOffsets, generateSpliceManifest } = require('./src/services/hls-proxy');
const { getSkipSegment, getSegments, getAllSegments } = require('./src/services/skip-service');
const userService = require('./src/services/user-service');
const axios = require('axios');

// Configure ffmpeg/ffprobe paths
const ffmpeg = require('fluent-ffmpeg');

// In production (Lite), we use the system-installed ffmpeg (from apt-get)
// We only use static binaries for local Windows dev if needed
if (process.platform === 'win32') {
    try {
        const ffmpegPath = require('ffmpeg-static');
        const ffprobePath = require('ffprobe-static').path;
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
    } catch (e) { console.log("Using system ffmpeg"); }
} else {
    // Linux/Docker: Use system paths
    ffmpeg.setFfmpegPath('ffmpeg');
    ffmpeg.setFfprobePath('ffprobe');
}

// Helper: Format Seconds to VTT Time (HH:MM:SS.mmm)
function toVTTTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    return date.toISOString().substr(11, 12);
}

// Configuration
const PORT = process.env.PORT || 7005;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;

// Manifest
const manifest = {
    id: "org.introhater.lite",
    version: "1.0.0",
    name: "IntroHater Lite",
    description: "Universal Skip Intro for Stremio (TV/Mobile/PC)",
    resources: ["stream"],
    types: ["movie", "series", "anime"],
    catalogs: [],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};

const builder = new addonBuilder(manifest);

// Stream Handler Function
async function handleStreamRequest(type, id, rdKey, baseUrl) {
    if (!rdKey) {
        console.error("[Lite] No RD Key provided.");
        return { streams: [] };
    }

    console.log(`[Lite] Request for ${type} ${id}`);
    let originalStreams = [];

    try {
        const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,rutor,rutracker,torrent9,mejortorrent,wolfmax4k%7Csort=qualitysize%7Clanguage=korean%7Cqualityfilter=scr,cam%7Cdebridoptions=nodownloadlinks,nocatalog%7Crealdebrid=${rdKey}/stream/${type}/${id}.json`;

        const response = await axios.get(torrentioUrl);
        if (response.status === 200) {
            const data = response.data;
            if (data.streams) {
                originalStreams = data.streams;
                console.log(`[Lite] Fetched ${originalStreams.length} streams from upstream`);
            }
        }
    } catch (e) {
        console.error("Error fetching upstream:", e.message);
    }

    if (originalStreams.length === 0) return { streams: [] };

    const skipSeg = getSkipSegment(id);
    if (skipSeg) {
        console.log(`[Lite] Found skip for ${id}: ${skipSeg.start}-${skipSeg.end}s`);
    }

    const modifiedStreams = originalStreams.map((stream) => {
        if (!stream.url) return null;

        // Magic Subtitles Injection
        const subtitles = [
            {
                url: `${baseUrl}/sub/status/${id}.vtt`,
                lang: 'eng',
                id: 'status',
                label: 'ℹ️ Status (Show Segments)'
            },
            {
                url: `${baseUrl}/sub/vote/up/${id}.vtt`,
                lang: 'eng',
                id: 'up',
                label: '👍 Upvote Skip'
            },
            {
                url: `${baseUrl}/sub/vote/down/${id}.vtt`,
                lang: 'eng',
                id: 'down',
                label: '👎 Downvote Skip'
            }
        ];

        if (skipSeg) {
            const encodedUrl = encodeURIComponent(stream.url);
            const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${encodedUrl}&start=${skipSeg.start}&end=${skipSeg.end}`;

            return {
                ...stream,
                url: proxyUrl,
                title: `⏭️ [Smart Skip] ${stream.title || stream.name}`,
                subtitles: subtitles,
                behaviorHints: { notWebReady: false }
            };
        } else {
            return {
                ...stream,
                subtitles: subtitles
            };
        }
    });

    return { streams: modifiedStreams.filter(Boolean) };
}

// Express Server
const app = express();
app.use(cors());

// 1. Serve Website (Docs)
app.use(express.static(path.join(__dirname, 'docs')));

// Middleware to extract config (RD Key)
// Supports /:config/manifest.json and /manifest.json (fallback env)
app.get(['/:config/manifest.json', '/manifest.json'], (req, res) => {
    const config = req.params.config;
    const manifestClone = { ...manifest };

    if (config) {
        manifestClone.description += " (Configured)";
    }

    res.json(manifestClone);
});

app.get(['/:config/stream/:type/:id.json', '/stream/:type/:id.json'], async (req, res) => {
    const { config, type, id } = req.params;
    // Prefer config from URL, fallback to env var
    const rdKey = config || process.env.RPDB_KEY;

    if (!rdKey) {
        return res.json({ streams: [{ title: "⚠️ Configuration Required. Please reinstall addon.", url: "" }] });
    }

    // Handle .json extension in ID if present (Stremio quirks)
    const cleanId = id.replace('.json', '');
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // Pass baseUrl to handleStreamRequest
    const result = await handleStreamRequest(type, cleanId, rdKey, baseUrl);
    res.json(result);
});

// 2. API: Leaderboard
app.get('/api/leaderboard', (req, res) => {
    const board = userService.getLeaderboard(20);
    res.json(board.map((u, i) => ({
        rank: i + 1,
        userId: u.userId,
        segments: u.segments,
        votes: u.votes
    })));
});

// 3. API: Catalog (Built from Skips)
// 3. API: Catalog (Built from Skips with OMDB Metadata)
app.get('/api/catalog', async (req, res) => {
    const allSkips = getAllSegments();
    const catalog = { lastUpdated: new Date().toISOString(), media: {} };

    // Simple in-memory cache for metadata to avoid hitting OMDB limits
    if (!global.metadataCache) global.metadataCache = {};

    const omdbKey = process.env.OMDB_API_KEY;

    for (const [key, segments] of Object.entries(allSkips)) {
        const parts = key.split(':');
        const imdbId = parts[0];
        const season = parts[1] ? parseInt(parts[1]) : null;
        const episode = parts[2] ? parseInt(parts[2]) : null;

        let meta = global.metadataCache[imdbId];

        // Fetch metadata if missing and key exists
        if (!meta && omdbKey) {
            try {
                // We don't await here to avoid blocking the response (lazy load)
                fetchOMDbData(imdbId, omdbKey).then(data => {
                    if (data) global.metadataCache[imdbId] = data;
                });
            } catch (e) {
                console.error(`OMDB Fetch Error for ${imdbId}:`, e.message);
            }
        }

        if (!catalog.media[imdbId]) {
            catalog.media[imdbId] = {
                title: meta ? meta.Title : imdbId,
                year: meta ? meta.Year : "????",
                poster: meta ? meta.Poster : null,
                type: season ? 'show' : 'movie',
                episodes: {},
                totalSegments: 0
            };
        }

        const media = catalog.media[imdbId];
        media.totalSegments += segments.length;

        if (season && episode) {
            const epKey = `${season}:${episode}`;
            if (!media.episodes[epKey]) {
                media.episodes[epKey] = {
                    season, episode, segmentCount: 0
                };
            }
            media.episodes[epKey].segmentCount += segments.length;
        }
    }
    res.json(catalog);
});

async function fetchOMDbData(imdbId, apiKey) {
    try {
        const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`;
        const response = await axios.get(url);
        if (response.data && response.data.Response === 'True') {
            console.log(`[OMDB] Fetched metadata for ${imdbId}: ${response.data.Title}`);
            return response.data;
        }
    } catch (e) {
        // Silent fail
    }
    return null;
}

// 4. API: Get Segments
app.get('/api/segments/:videoId', (req, res) => {
    const list = getSegments(req.params.videoId);
    res.json(list);
});

// 5. Auth Mock
app.get('/me', (req, res) => res.json(null));

app.get('/ping', (req, res) => res.send('pong'));

// Simple In-Memory Cache
const manifestCache = new Map();

// HLS Proxy Endpoint
app.get('/hls/manifest.m3u8', async (req, res) => {
    const { stream, start: startStr, end: endStr } = req.query;

    if (!stream) {
        return res.status(400).send("Missing stream URL");
    }

    try {
        let streamUrl = decodeURIComponent(stream);
        const introStart = parseFloat(startStr) || 0;
        const introEnd = parseFloat(endStr) || 0;

        // Cache Key
        const cacheKey = `${streamUrl}_${introStart}_${introEnd}`;
        if (manifestCache.has(cacheKey)) {
            console.log(`[HLS] Serving cached manifest for ${introStart}s - ${introEnd}s`);
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(manifestCache.get(cacheKey));
        }

        console.log(`[HLS] Generating manifest for Intro: ${introStart}s - ${introEnd}s`);

        // 0. Resolve Redirects & Get Length
        console.log(`[HLS] Probing URL: ${streamUrl}`);
        const details = await getStreamDetails(streamUrl);
        if (details.finalUrl !== streamUrl) {
            console.log(`[HLS] Resolved Redirect: ${details.finalUrl}`);
            streamUrl = details.finalUrl;
        }
        const totalLength = details.contentLength;
        console.log(`[HLS] Content-Length: ${totalLength || 'Unknown'}`);

        let manifest = "";
        let isSuccess = false;

        // 1. Get Offsets (Start & End)
        // If we have both, we try to splice
        if (introStart > 0 && introEnd > introStart) {
            const points = await getRefinedOffsets(streamUrl, introStart, introEnd);
            if (points) {
                console.log(`[HLS] Splicing at bytes: ${points.startOffset} -> ${points.endOffset}`);
                manifest = generateSpliceManifest(streamUrl, 7200, points.startOffset, points.endOffset, totalLength);
                isSuccess = true;
            } else {
                console.warn("[HLS] Failed to find splice points. Falling back to simple skip.");
            }
        }

        // Fallback or Simple Skip (Start at X)
        if (!manifest) {
            const startTime = introEnd || introStart;
            // Only try if startTime is valid
            if (startTime > 0) {
                const offset = await getByteOffset(streamUrl, startTime);

                if (offset > 0) {
                    manifest = generateSmartManifest(streamUrl, 7200, offset, totalLength, startTime);
                    isSuccess = true;
                } else {
                    console.warn(`[HLS] Failed to find offset for ${startTime}s. Returning non-skipping stream.`);
                    // We DO NOT cache this failure, so we can retry later
                }
            }
        }

        // If all logic failed, just return the original stream via redirect (uncached) to ensure playback works
        if (!manifest || !isSuccess) {
            console.log("Fallback: Redirecting to original stream (Server-side redirect)");
            return res.redirect(req.query.stream);
        }

        // Store in Cache ONLY on Success
        manifestCache.set(cacheKey, manifest);

        // 3. Serve
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);

    } catch (e) {
        console.error("Proxy Error:", e.message);
        // If an error occurs, we still redirect to the original stream
        console.log("Fallback: Redirecting to original stream (Error-based redirect)");
        res.redirect(req.query.stream);
    }
});

// 6. Magic Subtitles Endpoints

// Status Track: Shows "Skipping Intro..." at correct times
app.get('/sub/status/:videoId.vtt', (req, res) => {
    const vid = req.params.videoId;
    // We use getSegments from skip-service which returns all segments for this ID
    const segments = getSegments(vid) || [];

    let vtt = "WEBVTT\n\n";

    if (segments.length === 0) {
        vtt += `00:00:00.000 --> 00:00:05.000\nNo skip segments found.\n\n`;
    } else {
        segments.forEach(seg => {
            const start = toVTTTime(seg.start);
            const end = toVTTTime(seg.end);
            const label = seg.category || 'Intro';
            vtt += `${start} --> ${end}\n[${label}] ⏭️ Skipping...\n\n`;
        });
    }

    res.set('Content-Type', 'text/vtt');
    res.send(vtt);
});

// Voting Tracks: Side-effect endpoints
app.get('/sub/vote/:action/:videoId.vtt', (req, res) => {
    const { action, videoId } = req.params;

    console.log(`[MagicVote] User voted ${action.toUpperCase()} on ${videoId}`);

    // In a real app, we would call userService.vote() here.
    // For Lite, we just log it to console as requested.

    const vtt = `WEBVTT

00:00:00.000 --> 01:00:00.000
✅ Vote Registered: ${action.toUpperCase()}!
(Switch back to 'Status' or 'Turn Off' to resume normal playback)
`;

    res.set('Content-Type', 'text/vtt');
    res.send(vtt);
});

// Serve Addon
// Serve Addon - Handled by custom routes above
// app.use('/', addonRouter); // DEPRECATED

app.listen(PORT, () => {
    console.log(`IntroHater Lite running on ${PUBLIC_URL}`);
});
