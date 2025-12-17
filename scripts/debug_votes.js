require('dotenv').config();
const { MongoClient } = require('mongodb');

async function check() {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db();

    // Find anyone with votes > 1
    const highVoters = await db.collection('users').find({ votes: { $gt: 1 } }).toArray();
    console.log("Users with > 1 vote:", highVoters);

    // Check types
    if (highVoters.length > 0) {
        console.log("Type of votes:", typeof highVoters[0].votes);
    }

    await client.close();
}
check();
