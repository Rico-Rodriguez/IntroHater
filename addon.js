const { addonBuilder } = require("stremio-addon-sdk");

const SKIP_SECONDS = 10; // Time to skip in seconds

// Enable debug mode to see detailed logs
const DEBUG_MODE = true;

// Enhanced logger function that ensures logs are properly displayed
function enhancedLog(message, force = false) {
    if (DEBUG_MODE || force) {
        // Flush logs immediately
        console.log(message);
        process.stdout.write(''); // Force flush
    }
}

const manifest = {
    id: "org.introhater",
    version: "1.3.0", // Version bumped for core approach
    name: "IntroHater",
    description: `Skip first ${SKIP_SECONDS} seconds of any video`,
    resources: ["stream"],
    types: ["series", "movie"],
    catalogs: [],
    behaviorHints: {
        adult: false,
        p2p: false
    }
};

// Build our addon
const builder = new addonBuilder(manifest);

// Define a stream handler that modifies streams to skip first seconds
builder.defineStreamHandler(async ({ type, id, extra }) => {
    console.log(`\n[IntroHater] Stream handler called for ${type}/${id}`);
    
    try {
        // We need to fetch the original streams ourselves if not provided in extra
        let originalStreams = [];
        
        // Check if we have streams in extra (from another addon)
        if (extra && extra.streams && Array.isArray(extra.streams)) {
            console.log(`[IntroHater] Found ${extra.streams.length} streams in extra`);
            originalStreams = extra.streams;
        } else {
            // If no streams in extra, we need to fetch from Torrentio directly
            try {
                // Use the same realdebrid key from the URL you provided
                const rdKey = "IZCD7DULSF3O2ZPHUDBIACA2P6PKXOGVTP6JAQZ6ME7DOGA55NDA";
                
                // Build the same Torrentio URL format that was in your example
                const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,rutor,rutracker,torrent9,mejortorrent,wolfmax4k%7Csort=qualitysize%7Clanguage=korean%7Cqualityfilter=scr,cam%7Cdebridoptions=nodownloadlinks,nocatalog%7Crealdebrid=${rdKey}/stream/${type}/${id}.json`;
                
                // Fetch the streams from Torrentio
                const response = await fetch(torrentioUrl);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.streams && Array.isArray(data.streams)) {
                        originalStreams = data.streams;
                        console.log(`[IntroHater] Fetched ${originalStreams.length} streams from Torrentio`);
                    }
                }
            } catch (fetchError) {
                // Silent error handling
            }
        }
        
        // Track stream types for logging
        let directStreamCount = 0;
        let proxiedStreamCount = 0;
        
        // Enhanced version of the stream handling in your defineStreamHandler function

        // Process all streams to create modified versions
        const modifiedStreams = originalStreams.map((stream, index) => {
            // Skip streams without a URL
            if (!stream.url) return null;
            
            // Create a modified copy with skip intro functionality
            const modifiedStream = JSON.parse(JSON.stringify(stream)); // Deep clone
            const url = modifiedStream.url;
            
            // First, analyze the stream completely before making any modifications
            const fileExtension = getFileExtension(url);
            const { sourceType, sourceDetails } = analyzeStreamSource(modifiedStream);
            
            // Clean URL without fragments
            let cleanUrl = url;
            if (cleanUrl.includes('#')) {
                cleanUrl = cleanUrl.split('#')[0];
            }
            
            // IMPROVED CLASSIFICATION: Determine if stream is direct or proxied
            const willBeProxied = determineStreamType(modifiedStream, fileExtension);
            enhancedLog(`[IntroHater] Stream ${index+1} (${fileExtension.toUpperCase()}): ${willBeProxied ? 'PROXIED' : 'DIRECT'}`, true);
            
            // Set basic behavior hints for all streams
            modifiedStream.behaviorHints = modifiedStream.behaviorHints || {};
            modifiedStream.behaviorHints.timeOffset = SKIP_SECONDS;
            
            // DIRECT STREAMS - Use simple fragment approach
            if (!willBeProxied) {
                directStreamCount++;
                modifiedStream.url = `${cleanUrl}#t=${SKIP_SECONDS}`;
                modifiedStream.name = `[${index+1}] ⏭️✅ ${modifiedStream.name || ''} (${fileExtension.toUpperCase()})`;
                enhancedLog(`[IntroHater] Direct stream modified: ${modifiedStream.url}`, true);
                return modifiedStream;
            }
            
            // PROXIED STREAMS - Handle based on type
            proxiedStreamCount++;
            
            // Apply both source-specific and general time hints
            switch (sourceType) {
                case 'youtube':
                    modifiedStream.behaviorHints.youtubeStartTime = SKIP_SECONDS;
                    modifiedStream.name = `[${index+1}] ⏭️🎬 ${modifiedStream.name || ''} (YT)`;
                    break;
                    
                case 'magnet':
                case 'torrent':
                    modifiedStream.behaviorHints.startTime = SKIP_SECONDS; 
                    modifiedStream.name = `[${index+1}] ⏭️🧲 ${modifiedStream.name || ''} (${sourceType})`;
                    break;
                    
                case 'streaming_server':
                    if (cleanUrl.includes('?')) {
                        modifiedStream.url = `${cleanUrl}&t=${SKIP_SECONDS}`;
                    } else {
                        modifiedStream.url = `${cleanUrl}?t=${SKIP_SECONDS}`;
                    }
                    modifiedStream.name = `[${index+1}] ⏭️🔄 ${modifiedStream.name || ''} (SERVER)`;
                    break;
                    
                default:
                    // SPECIAL HANDLING FOR .AVI AND .MKV FILES
                    if (fileExtension === 'avi' || fileExtension === 'mkv' || 
                        url.includes('.avi') || url.includes('.mkv')) {
                        
                        enhancedLog("[IntroHater] Applying basic AVI/MKV handling", true);
                        
                        // Add basic behavior hints that *might* work
                        modifiedStream.behaviorHints.startTime = SKIP_SECONDS;
                        
                        // Mark these streams with a special icon to indicate limited support
                        modifiedStream.name = `[${index+1}] ⏭️❓ ${modifiedStream.name || ''} (${fileExtension.toUpperCase()})`;
                    } 
                    // REGULAR HLS OR OTHER PROXIED STREAMS
                    else {
                        // Apply standard behavior hints
                        modifiedStream.behaviorHints.startTime = SKIP_SECONDS;
                        modifiedStream.behaviorHints.timeOffset = SKIP_SECONDS;
                        
                        // Mark these streams as potentially not supporting skipping
                        modifiedStream.name = `[${index+1}] ⏭️❓ ${modifiedStream.name || ''} (${fileExtension.toUpperCase()})`;
                        
                        enhancedLog("[IntroHater] Using basic time hints for proxied stream", true);
                    }
                    break;
            }
            
            enhancedLog(`[IntroHater] Proxied stream modified: ${modifiedStream.url}`, true);
            return modifiedStream;
        }).filter(Boolean);
        
        // If no streams were found, add our test stream for debugging
        if (modifiedStreams.length === 0) {
            console.log('[IntroHater] No streams found, adding test stream');
            
            const testStreamModified = {
                name: "⏭️ IntroHater Test",
                title: "Test Stream",
                type: "other",
                url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4#t=10",
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: "introhater",
                    timeOffset: SKIP_SECONDS,
                    streamId: "test_stream_mp4"
                }
            };
            
            modifiedStreams.push(testStreamModified);
        }
        
        console.log(`[IntroHater] Processed ${modifiedStreams.length} streams (${directStreamCount} direct, ${proxiedStreamCount} proxied)`);
        console.log('[IntroHater] -----------------------------------------------');
        
        // Add these properties to all streams
        modifiedStreams.forEach(stream => {
            // Keep existing modifications
            
            // Add library integration hints
            stream.behaviorHints = stream.behaviorHints || {};
            stream.behaviorHints.libraryItemTimeOffset = SKIP_SECONDS;
            
            // Match the internal property name from stremio-core
            stream.state = stream.state || {};
            stream.state.time_offset = SKIP_SECONDS;
        });
        
        return { streams: modifiedStreams };
    } catch (error) {
        console.error('[IntroHater] Error in stream handler:', error);
        return { streams: [] };
    }
});

// Add this new function to your code

// Simplified function to determine stream type with clearer rules

function determineStreamType(stream, extension) {
    const url = stream.url || '';
    
    // CLEAR CASES OF DIRECT STREAMS
    // 1. Web-standard video formats (MP4, WebM) from direct sources
    if (['mp4', 'webm', 'ogg'].includes(extension) && 
        !url.includes('127.0.0.1') && 
        !url.startsWith('magnet:')) {
        enhancedLog('[IntroHater] DIRECT: Web-standard video format', true);
        return false; // Not proxied
    }
    
    // CLEAR CASES OF PROXIED STREAMS
    // 1. Already using streaming server
    if (url.includes('127.0.0.1:11470') || url.includes('/hlsv2/')) {
        enhancedLog('[IntroHater] PROXIED: Using streaming server', true);
        return true;
    }
    
    // 2. Torrent/magnet protocols
    if (url.startsWith('magnet:') || url.includes('.torrent')) {
        enhancedLog('[IntroHater] PROXIED: Torrent source', true);
        return true;
    }
    
    // 3. Non-web formats requiring transcoding
        enhancedLog('[IntroHater] DIRECT: Default for MP4', true);
        return false;
    } else {
        enhancedLog('[IntroHater] PROXIED: Default for non-MP4', true);
        return true;
    }
}

// Enhanced function to determine if a stream will be proxied by Stremio
function shouldBeProxied(stream, extension) {
    // The URL should be extracted from the stream object
    const url = stream.url || '';
    
    // Add detailed logging to help understand the stream classification
    console.log(`[IntroHater] Analyzing stream URL: ${url.substring(0, 60)}...`);
    
    // Clear signals from URL that it will be proxied
    if (url.includes('127.0.0.1:11470') || 
        url.includes('/hlsv2/') || 
        url.includes('stremio-streaming-server')) {
        console.log('[IntroHater] Stream identified as proxied (server patterns)');
        return true;
    }
    
    // Check for streaming service URLs that Stremio will likely proxy
    if (url.includes('netflix.com') || 
        url.includes('hulu.com') || 
        url.includes('amazon.com/gp/video') ||
        url.includes('hbo.com')) {
        console.log('[IntroHater] Stream identified as proxied (streaming service)');
        return true;
    }
    
    // Check for protocol schemes that suggest proxy handling
    if (url.startsWith('magnet:') || 
        url.startsWith('torrent:') || 
        url.startsWith('infohash:')) {
        console.log('[IntroHater] Stream identified as proxied (torrent protocol)');
        return true;
    }
    
    // Check behavior hints for notWebReady flag - FIX: use stream parameter instead of undefined variable
    if ((stream.behaviorHints && stream.behaviorHints.notWebReady === true) ||
        (url.includes('.mkv') && !url.includes('real-debrid.com'))) {
        console.log('[IntroHater] Stream identified as proxied (not web ready)');
        return true;
    }
    
    // Check if this is a real-debrid URL or has signs of direct streaming
    if (url.includes('real-debrid.com/d/') || 
        url.includes('debrid-link.com') ||
        url.includes('premiumize.me')) {
        console.log('[IntroHater] Stream identified as direct (debrid service)');
        return false;
    }
    
    // Check for direct streaming file types
    if (['mp4', 'webm', 'mp3', 'aac', 'wav', 'ogg'].includes(extension)) {
        console.log('[IntroHater] Stream identified as direct (web-ready format)');
        return false;
    }
    
    // By default, assume non-web-standard video formats will be proxied
    if (['mkv', 'avi', 'flv', 'wmv', 'mov'].includes(extension)) {
        console.log('[IntroHater] Stream identified as proxied (non-web format)');
        return true;
    }
    
    console.log('[IntroHater] Stream identified as proxied (default assumption)');
    // Default to assuming proxy for safety
    return true;
}

// Minimal HTTP request monitoring to track what's happening
const http = require('http');
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, req, res) {
    if (event === 'request') {
        try {
            const url = req.url;
            
            // Only monitor for stream playback requests
            if (url && url.includes('mediaURL=')) {
                const params = new URLSearchParams(url.split('?')[1] || '');
                const mediaURL = params.get('mediaURL') || '';
                
                if (mediaURL) {
                    let decodedUrl = '';
                    try {
                        decodedUrl = decodeURIComponent(mediaURL);
                    } catch (e) {
                        decodedUrl = mediaURL;
                    }
                    
                    // Only log the essential details
                    console.log(`\n[IntroHater] Playing stream: ${decodedUrl}`);
                    console.log(`[IntroHater] Has #t param: ${decodedUrl.includes('#t=') ? 'YES' : 'NO'}`);
                    console.log(`[IntroHater] Is proxied: ${url.includes('127.0.0.1:11470') ? 'YES' : 'NO'}`);
                    console.log('[IntroHater] -----------------------------------------------');
                }
            }
        } catch (e) {
            // Silent error handling
        }
    }
    return originalEmit.apply(this, arguments);
};

// Helper function to extract file extension from URL
function getFileExtension(url) {
    try {
        const path = url.split('/').pop();
        if (!path) return 'unknown';
        
        const dotParts = path.split('.');
        if (dotParts.length <= 1) return 'unknown';
        
        let ext = dotParts.pop().toLowerCase();
        ext = ext.split('?')[0].split('#')[0];
        
        return ext || 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

// Add this function to your addon

// Enhanced request tracking to see how streams are processed
function enhancedTracking() {
    const http = require('http');
    const https = require('https');
    
    // Track HTTP requests
    const originalHttpRequest = http.request;
    http.request = function() {
        const req = originalHttpRequest.apply(this, arguments);
        
        try {
            const options = arguments[0];
            const url = typeof options === 'string' ? options : 
                       (options.href || `${options.protocol || 'http:'}//${options.hostname || options.host}${options.path || '/'}`);
            
            // Check if this is a streaming-related request
            if (url.includes('/stream/') || url.includes('hlsv2') || url.includes('127.0.0.1:11470')) {
                console.log(`\n[IntroHater] HTTP Request: ${url}`);
                
                // Check for time parameters
                const hasTimeParam = 
                    url.includes('#t=') || 
                    url.includes('?time=') || 
                    url.includes('&time=') ||
                    url.includes('start=');
                    
                console.log(`[IntroHater] Has time parameter: ${hasTimeParam ? 'YES' : 'NO'}`);
                
                // Listen for response
                req.on('response', (res) => {
                    console.log(`[IntroHater] Response status: ${res.statusCode}`);
                    console.log('[IntroHater] Response headers:', JSON.stringify(res.headers, null, 2));
                });
            }
        } catch (e) {
            // Silent error
        }
        
        return req;
    };
    
    // Also track HTTPS requests
    const originalHttpsRequest = https.request;
    https.request = function() {
        const req = originalHttpsRequest.apply(this, arguments);
        
        try {
            const options = arguments[0];
            const url = typeof options === 'string' ? options : 
                       (options.href || `${options.protocol || 'https:'}//${options.hostname || options.host}${options.path || '/'}`);
            
            // Check if this is a streaming-related request
            if (url.includes('/stream/') || url.includes('hlsv2') || url.includes('streaming')) {
                console.log(`\n[IntroHater] HTTPS Request: ${url}`);
                
                // Check for time parameters
                const hasTimeParam = 
                    url.includes('#t=') || 
                    url.includes('?time=') || 
                    url.includes('&time=') ||
                    url.includes('start=');
                    
                console.log(`[IntroHater] Has time parameter: ${hasTimeParam ? 'YES' : 'NO'}`);
            }
        } catch (e) {
            // Silent error
        }
        
        return req;
    };
}

// Call this function to enable tracking
enhancedTracking();

// Add this function to process streams based on their source type

function analyzeStreamSource(stream) {
    // Extract source type for more informed processing
    let sourceType = 'unknown';
    let sourceDetails = {};
    
    // Check for different stream source types based on URL patterns
    if (stream.url) {
        if (stream.url.startsWith('magnet:')) {
            sourceType = 'magnet';
            // Extract info hash if possible
            const infoHashMatch = stream.url.match(/xt=urn:btih:([^&]+)/i);
            if (infoHashMatch) {
                sourceDetails.infoHash = infoHashMatch[1];
            }
        } else if (stream.url.includes('youtube.com') || stream.url.includes('youtu.be')) {
            sourceType = 'youtube';
            // Extract video ID if possible
            const ytIdMatch = stream.url.match(/(?:v=|youtu\.be\/)([^&?]+)/i);
            if (ytIdMatch) {
                sourceDetails.ytId = ytIdMatch[1];
            }
        } else if (stream.url.includes('.torrent')) {
            sourceType = 'torrent';
        } else if (stream.url.includes('127.0.0.1:11470')) {
            sourceType = 'streaming_server';
            // Extract parts of the URL for analysis
            const urlParts = stream.url.split('/');
            if (urlParts.length > 4) {
                sourceDetails.serverEndpoint = urlParts[3];
            }
        } else {
            sourceType = 'http';
            // Check for common file extensions
            const extensions = ['mp4', 'mkv', 'webm', 'avi', 'm3u8', 'ts'];
            for (const ext of extensions) {
                if (stream.url.includes(`.${ext}`)) {
                    sourceDetails.fileType = ext;
                    break;
                }
            }
        }
    }
    
    // Check for behavior hints indicating source type
    if (stream.behaviorHints) {
        if (stream.behaviorHints.notWebReady) {
            sourceType = sourceType === 'unknown' ? 'not_web_ready' : sourceType;
            sourceDetails.requiresTranscoding = true;
        }
    }
    
    console.log(`[IntroHater] Stream source type: ${sourceType}`, sourceDetails);
    return { sourceType, sourceDetails };
}

// Replace the monitorStreamParameters function with this more aggressive implementation

function monitorStreamParameters() {
    enhancedLog("[IntroHater] Installing stream parameter monitor...", true);
    
    // Override fetch to intercept and modify streaming requests
    const originalFetch = global.fetch;
    
    global.fetch = async function(url, options) {
        if (typeof url === 'string') {
            // Check if this is a streaming server request
            if (url.includes('/hlsv2/') || url.includes('127.0.0.1:11470')) {
                enhancedLog(`\n[IntroHater] INTERCEPTED STREAM REQUEST: ${url.substring(0, 80)}...`, true);
                
                try {
                    // Parse the URL to modify parameters
                    const urlObj = new URL(url);
                    const mediaURL = urlObj.searchParams.get('mediaURL');
                    
                    if (mediaURL) {
                        enhancedLog(`[IntroHater] Original mediaURL: ${decodeURIComponent(mediaURL).substring(0, 80)}...`, true);
                        
                        // Create a modified mediaURL with our time parameters
                        let decodedURL = decodeURIComponent(mediaURL);
                        let modifiedURL = decodedURL;
                        
                        // Add ALL possible time parameters to maximize chances of success
                        if (!modifiedURL.includes('start_time=') && !modifiedURL.includes('#t=')) {
                            if (modifiedURL.includes('?')) {
                                modifiedURL = `${modifiedURL}&start_time=${SKIP_SECONDS}&startPosition=${SKIP_SECONDS}&t=${SKIP_SECONDS}`;
                            } else {
                                modifiedURL = `${modifiedURL}?start_time=${SKIP_SECONDS}&startPosition=${SKIP_SECONDS}&t=${SKIP_SECONDS}`;
                            }
                            
                            // Set the modified URL back to the request
                            urlObj.searchParams.set('mediaURL', modifiedURL);
                            
                            // Also add direct parameters to the HLS request itself
                            urlObj.searchParams.set('startPosition', SKIP_SECONDS.toString());
                            urlObj.searchParams.set('start_time', SKIP_SECONDS.toString());
                            urlObj.searchParams.set('t', SKIP_SECONDS.toString());
                            
                            // Replace the original URL with our modified version
                            url = urlObj.toString();
                            
                            enhancedLog(`[IntroHater] MODIFIED REQUEST: ${url.substring(0, 80)}...`, true);
                        }
                    }
                } catch (e) {
                    enhancedLog(`[IntroHater] Error modifying URL: ${e.message}`, true);
                }
            }
        }
        
        // Call the original fetch with possibly modified URL
        return originalFetch.call(this, url, options);
    };
    
    enhancedLog("[IntroHater] Stream parameter monitor installed successfully", true);
}

// Call the monitoring function
monitorStreamParameters();

module.exports = builder.getInterface();

if (require.main === module) {
    const { serveHTTP } = require('stremio-addon-sdk');
    serveHTTP(builder.getInterface(), { port: 7000 })
        .then(() => {
            console.log('\n[IntroHater] Addon server running at http://127.0.0.1:7000');
            console.log('[IntroHater] Use http://127.0.0.1:7000/manifest.json to install locally');
            console.log('[IntroHater] Streams marked with ⏭️✅ will skip intros automatically');
            console.log('[IntroHater] Streams marked with ⏭️❓ may not skip intros (limitation of Stremio)');
            console.log('[IntroHater] -----------------------------------------------');
        });
}

// Add this at the end of your file before the module.exports

// Global error handler to catch and report issues
process.on('uncaughtException', (err) => {
    enhancedLog(`[IntroHater] UNCAUGHT EXCEPTION: ${err.message}`, true);
    enhancedLog(err.stack, true);
});

process.on('unhandledRejection', (reason, promise) => {
    enhancedLog('[IntroHater] UNHANDLED REJECTION:', true);
    enhancedLog(`Reason: ${reason}`, true);
});

// Add this function to the bottom of your file before module.exports

// Update the interception function for clarity

function interceptHttpRequests() {
    enhancedLog("[IntroHater] Setting up focused HTTP request interception", true);
    
    const http = require('http');
    
    // Intercept HTTP requests - simplified version
    const originalHttpRequest = http.request;
    http.request = function() {
        try {
            const options = arguments[0];
            
            // Only log streaming server requests for debugging purposes
            if (typeof options === 'object' && options.path && 
                options.path.includes('mediaURL=') && 
                (options.hostname === '127.0.0.1' || options.host === '127.0.0.1')) {
                
                enhancedLog(`[IntroHater] STREAMING REQUEST DETECTED: ${options.path.substring(0, 60)}...`, true);
                
                // Just log the request but don't modify - modifications didn't work
                try {
                    const pathParts = options.path.split('?');
                    if (pathParts.length > 1) {
                        const params = new URLSearchParams(pathParts[1]);
                        
                        if (params.has('mediaURL')) {
                            let mediaURL = params.get('mediaURL');
                            try {
                                mediaURL = decodeURIComponent(mediaURL);
                            } catch (e) {}
                            
                            enhancedLog(`[IntroHater] Media URL: ${mediaURL.substring(0, 60)}...`, true);
                        }
                    }
                } catch (e) {
                    // Silent error
                }
            }
        } catch (e) {
            // Silent error
        }
        
        return originalHttpRequest.apply(this, arguments);
    };
    
    enhancedLog("[IntroHater] HTTP monitoring ready", true);
}

/**
 * ******************** LESSONS LEARNED - DO NOT DELETE THIS COMMENT UNDER ANY CIRCUMSTANCES ********************
 * 
 * FINDINGS ON STREMIO STREAM SKIPPING:
 * 
 * 1. WHAT WORKS:
 *    - Direct streams (web-ready MP4, WebM) with #t=X fragment parameter
 *    - YouTube streams with behaviorHints.youtubeStartTime parameter
 *    - Torrent/magnet links with behaviorHints.startTime parameter
 * 
 * 2. WHAT DOESN'T WORK:
 *    - Aggressive parameter injection via HTTP request interception
 *    - Modifying the mediaURL parameter in streaming server requests
 *    - Adding time parameters (start_time, startPosition, t) to streaming server URLs
 *    - Adding custom headers (X-Start-Time, X-Start-Position) to proxied streams
 *    - Various combinations of URL parameters for AVI/MKV files
 * 
 * 3. STREAMING SERVER BEHAVIOR:
 *    - The streaming server (127.0.0.1:11470) completely ignores time parameters
 *    - When proxying content, the original parameters in the source URL are discarded
 *    - The HLS protocol implementation in Stremio does not support starting at a specific time
 *    - Different streams are handled differently even if they appear to be the same type
 * 
 * 4. THEORIES:
 *    - The streaming server may require internal modifications to support time skipping
 *    - The web player component may need custom time seeking after stream initialization
 *    - Non-web-ready formats require transcoding which resets any time parameters
 * 
 * 5. POSSIBLE FUTURE APPROACHES:
 *    - Investigate Stremio core/streaming server source code for potential hooks
 *    - Create a custom player wrapper that auto-seeks after loading
 *    - Explore JavaScript injection into the web player
 *    - Request an official API for time skipping from the Stremio team
 * 
 * ********************************************************************************************************
 */

// Remove the aggressive fetch interception as it doesn't work
// monitorStreamParameters();
