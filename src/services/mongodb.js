const { MongoClient } = require('mongodb');

class MongoService {
    constructor() {
        this.client = null;
        this.db = null;
        this.uri = process.env.MONGODB_URI;
    }

    async connect() {
        // If already connected, return db
        if (this.db) return this.db;

        // If no URI, return null (fallback to memory/file will be handled by consumer)
        if (!this.uri) {
            if (!this.warned) {
                console.warn("[MongoDB] No MONGODB_URI provided. Using in-memory/file storage (Ephemeral).");
                this.warned = true;
            }
            return null;
        }

        try {
            this.client = new MongoClient(this.uri);
            await this.client.connect();
            this.db = this.client.db();
            console.log("[MongoDB] Connected successfully.");
            return this.db;
        } catch (e) {
            console.error("[MongoDB] Connection failed:", e.message);
            return null;
        }
    }

    async getCollection(name) {
        const db = await this.connect();
        if (!db) return null;
        return db.collection(name);
    }
}

module.exports = new MongoService();
