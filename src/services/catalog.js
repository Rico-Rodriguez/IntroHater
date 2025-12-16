const fs = require('fs').promises;
const path = require('path');
const { OMDB } = require('../config/constants');

// Change to the proper persistent directory in ubuntu's home
const CATALOG_DIR = '/home/ubuntu/.introhater';
const CATALOG_FILE = path.join(CATALOG_DIR, 'catalog.json');
const CATALOG_BACKUP = path.join(CATALOG_DIR, 'catalog.backup.json');

async function ensureCatalogDir() {
    try {
        await fs.mkdir(CATALOG_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating catalog directory:', error);
    }
}

async function readCatalog() {
    try {
        await ensureCatalogDir();
        
        // Try to read the main catalog file
        try {
            const data = await fs.readFile(CATALOG_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // If main file doesn't exist, try to read the backup
                try {
                    const backupData = await fs.readFile(CATALOG_BACKUP, 'utf8');
                    const catalog = JSON.parse(backupData);
                    // Restore from backup
                    await writeCatalog(catalog);
                    console.log('Restored catalog from backup');
                    return catalog;
                } catch (backupError) {
                    // If no backup exists either, create a new catalog
                    const defaultCatalog = {
                        lastUpdated: null,
                        media: {}
                    };
                    await writeCatalog(defaultCatalog);
                    return defaultCatalog;
                }
            }
            throw error;
        }
    } catch (error) {
        console.error('Error reading catalog:', error);
        return { lastUpdated: null, media: {} };
    }
}

async function writeCatalog(catalog) {
    try {
        await ensureCatalogDir();
        
        // Write the main catalog file
        await fs.writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2));
        
        // Create a backup
        await fs.writeFile(CATALOG_BACKUP, JSON.stringify(catalog, null, 2));
    } catch (error) {
        console.error('Error writing catalog:', error);
    }
}

async function fetchOMDbData(imdbId) {
    try {
        const response = await fetch(`${OMDB.BASE_URL}/?i=${imdbId}&apikey=${OMDB.API_KEY}`);
        if (!response.ok) throw new Error('Failed to fetch OMDB data');
        return await response.json();
    } catch (error) {
        console.error('Error fetching OMDB data:', error);
        return null;
    }
}

async function updateCatalog(segment) {
    const catalog = await readCatalog();
    const [imdbId, season, episode] = segment.videoId.split(':');
    
    // If we haven't seen this media before
    if (!catalog.media[imdbId]) {
        const omdbData = await fetchOMDbData(imdbId);
        if (!omdbData) return;

        catalog.media[imdbId] = {
            title: omdbData.Title,
            year: omdbData.Year,
            type: season && episode ? 'show' : 'movie',
            episodes: {},
            addedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            totalSegments: 0
        };
    }

    const media = catalog.media[imdbId];
    
    // For TV shows, track episodes
    if (season && episode) {
        const episodeKey = `${season}:${episode}`;
        if (!media.episodes[episodeKey]) {
            media.episodes[episodeKey] = {
                season: parseInt(season),
                episode: parseInt(episode),
                segmentCount: 0,
                addedAt: new Date().toISOString()
            };
        }
        media.episodes[episodeKey].segmentCount++;
    }

    media.totalSegments++;
    media.lastUpdated = new Date().toISOString();
    catalog.lastUpdated = new Date().toISOString();

    await writeCatalog(catalog);
}

async function getCatalogData() {
    return await readCatalog();
}

module.exports = {
    updateCatalog,
    getCatalogData
};