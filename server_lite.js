require('dotenv').config();
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
const crypto = require('crypto');

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

// Helper: Generate Secure User ID from RD Key
function generateUserId(rdKey) {
    if (!rdKey) return 'anonymous';
    return crypto.createHash('md5').update(rdKey).digest('hex');
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

    if (originalStreams.length === 0) return { streams: [] };

    // FETCH SKIP (Async now because of Aniskip)
    const skipSeg = await getSkipSegment(id);
    if (skipSeg) {
        console.log(`[Lite] Found skip for ${id}: ${skipSeg.start}-${skipSeg.end}s`);
    }

    const modifiedStreams = [];

    originalStreams.forEach((stream) => {
        if (!stream.url) return;

        const encodedUrl = encodeURIComponent(stream.url);

        // 1. Smart Skip Stream (The Main Experience)
        if (skipSeg) {
            // Point to Master Playlist (still good for HLS compliance) 
            // OR reuse the media playlist directly if we don't use subtitles anymore.
            // Let's stick to master.m3u8 for future-proofing, but we remove the subtitle params in the master generation if unused.
            // Actually, let's simplify back to the direct HLS proxy for reliability unless we need the master.
            const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${encodedUrl}&start=${skipSeg.start}&end=${skipSeg.end}`;

            modifiedStreams.push({
                ...stream,
                url: proxyUrl,
                title: `[Play with skip] ${stream.title || stream.name}`,
                behaviorHints: { notWebReady: false }
            });

            // 2. Upvote Action (Reloads with Skip)
            const userId = generateUserId(rdKey);

            modifiedStreams.push({
                ...stream,
                name: '👍', // Keep original name to blend in
                title: `[Upvote skip & play]`,
                url: `${baseUrl}/vote/up/${id}?stream=${encodedUrl}&start=${skipSeg.start}&end=${skipSeg.end}&user=${userId}`
            });

            // 3. Downvote Action (Reloads WITHOUT Skip - Fixes playback)
            modifiedStreams.push({
                ...stream,
                name: '👎', // Keep original name
                title: `[Disable skip & Downvote]`,
                url: `${baseUrl}/vote/down/${id}?stream=${encodedUrl}&user=${userId}`
            });

        } else {
            // No skip found - just pass through or maybe offer "Create"? 
            // For Lite, we just pass through.
            modifiedStreams.push(stream);
        }
    });

    return { streams: modifiedStreams };
}

// Express Server
const app = express();
app.set('trust proxy', true); // Trust Render/Heroku proxy for correct protocol (https)
app.use(cors());

// 1. Serve Website (Docs)
app.use(express.static(path.join(__dirname, 'docs')));

// Handle /configure and /:config/configure to redirect to main page or serve it
app.get(['/configure', '/:config/configure'], (req, res) => {
    // If config is present, we could potentially inject it, but for now just serving the static HTML is safer/easier.
    // The user can re-enter their key or we can parse it from URL in frontend if we want to be fancy.
    // For now, let's just serve the file.
    res.sendFile(path.join(__dirname, 'docs', 'configure.html'));
});

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
app.get('/api/leaderboard', async (req, res) => {
    const board = await userService.getLeaderboard(20);
    res.json(board.map((u, i) => ({
        rank: i + 1,
        userId: u.userId,
        segments: u.segments,
        votes: u.votes
    })));
});

// 2.5 API: Stats
app.get('/api/stats', async (req, res) => {
    const { userCount, voteCount } = await userService.getStats();
    // Get total skips from all segments
    const allSkips = getAllSegments();
    const skipCount = Object.values(allSkips).flat().length;

    res.json({
        users: userCount,
        skips: skipCount,
        votes: voteCount
    });
});

// 2.6 API: Personal Stats (Protected by RD Key)
app.use(express.json()); // Enable JSON body parsing for this endpoint
app.post('/api/stats/personal', async (req, res) => {
    const { rdKey } = req.body;
    if (!rdKey) return res.status(400).json({ error: "RD Key required" });

    const userId = generateUserId(rdKey);
    const stats = await userService.getUserStats(userId);

    if (stats) {
        // Calculate rank
        const leaderboard = await userService.getLeaderboard(1000);
        const rank = leaderboard.findIndex(u => u.userId === userId) + 1;

        res.json({
            ...stats,
            userId: userId, // Return the ID so we can show it
            rank: rank > 0 ? rank : "-"
        });
    } else {
        res.json({ userId: userId, segments: 0, votes: 0, rank: "-" });
    }
});

// 3. API: Catalog (Built from Skips)
// 3. API: Catalog (Built from Skips with OMDB Metadata)
app.get('/api/catalog', async (req, res) => {
    const allSkips = getAllSegments();
    const catalog = { lastUpdated: new Date().toISOString(), media: {} };

    // Simple in-memory cache for metadata to avoid hitting OMDB limits
    if (!global.metadataCache) global.metadataCache = {};

    const omdbKey = process.env.OMDB_API_KEY;



    // 1. Collect Missing IDs
    const missingIds = new Set();
    for (const key of Object.keys(allSkips)) {
        const imdbId = key.split(':')[0];
        if (!global.metadataCache[imdbId]) {
            missingIds.add(imdbId);
        }
    }

    // 2. Fetch Missing Metadata (Parallel)
    if (missingIds.size > 0 && omdbKey) {
        console.log(`[Catalog] Fetching metadata for ${missingIds.size} items...`);
        const promises = Array.from(missingIds).map(id => fetchOMDbData(id, omdbKey));
        const results = await Promise.all(promises);
        results.forEach(data => {
            if (data && data.imdbID) {
                global.metadataCache[data.imdbID] = data;
            }
        });
    }

    // 3. Build Catalog (Now with populated cache)
    for (const [key, segments] of Object.entries(allSkips)) {
        const parts = key.split(':');
        const imdbId = parts[0];
        const season = parts[1] ? parseInt(parts[1]) : null;
        const episode = parts[2] ? parseInt(parts[2]) : null;

        let meta = global.metadataCache[imdbId];

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

// HLS Master Playlist Endpoint
// This is the entry point for the player. It defines video + subtitles.
app.get('/hls/master.m3u8', (req, res) => {
    const { stream, start, end, id } = req.query;
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // Reconstruct the media URL (the video)
    // We pass the same params to it
    const mediaUrl = `${baseUrl}/hls/media.m3u8?stream=${encodeURIComponent(stream)}&start=${start}&end=${end}`;

    // Subtitle Playlists (M3U8 wrappers)
    const subStatus = `${baseUrl}/sub/playlist/status/${id}.m3u8`;
    const subUp = `${baseUrl}/sub/playlist/up/${id}.m3u8`;
    const subDown = `${baseUrl}/sub/playlist/down/${id}.m3u8`;

    // Master Playlist Content
    const master = `#EXTM3U
#EXT-X-VERSION:3

#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="ℹ️ Status",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="fre",URI="${subStatus}"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="👍 Upvote Skip",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="ger",URI="${subUp}"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="👎 Downvote Skip",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="spa",URI="${subDown}"

#EXT-X-STREAM-INF:BANDWIDTH=5000000,SUBTITLES="subs"
${mediaUrl}
`;

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(master);
});

// Subtitle Playlist (Wrapper for VTT)
app.get('/sub/playlist/:type/:id.m3u8', (req, res) => {
    const { type, id } = req.params;
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // Determine the VTT URL based on type
    let vttUrl = "";
    if (type === 'status') vttUrl = `${baseUrl}/sub/status/${id}.vtt`;
    else vttUrl = `${baseUrl}/sub/vote/${type}/${id}.vtt`;

    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:7200
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:7200,
${vttUrl}
#EXT-X-ENDLIST`;

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlist);
});

// HLS Media Playlist Endpoint (Formerly manifest.m3u8)
// Returns the spliced video segments
// HLS Media Playlist Endpoint (Formerly manifest.m3u8)
// Returns the spliced video segments
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
// Voting Actions Redirects
app.get('/vote/:action/:videoId', (req, res) => {
    const { action, videoId } = req.params;
    const { stream, start, end, user } = req.query; // stream is encoded URL
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const userId = user || 'anonymous';
    console.log(`[Vote] User ${userId.substr(0, 6)}... voted ${action.toUpperCase()} on ${videoId}`);

    // Track vote for specific user
    userService.updateUserStats(userId, {
        votes: 1,
        videoId: videoId // Explicitly pass videoId as videoId for the list check
    });

    if (action === 'down') {
        // Downvote -> Redirect to ORIGINAL stream (No skipping)
        // We decode it because Stremio needs the real URL now
        const originalUrl = decodeURIComponent(stream);
        console.log(`[Vote] Redirecting to original: ${originalUrl}`);
        res.redirect(originalUrl);
    } else {
        // Upvote -> Redirect to SKIPPING stream
        const proxyUrl = `${baseUrl}/hls/manifest.m3u8?stream=${stream}&start=${start}&end=${end}`;
        console.log(`[Vote] Redirecting to skip: ${proxyUrl}`);
        res.redirect(proxyUrl);
    }
});

// Serve Addon
// Serve Addon - Handled by custom routes above
// app.use('/', addonRouter); // DEPRECATED

app.listen(PORT, () => {
    console.log(`IntroHater Lite running on ${PUBLIC_URL}`);
});
