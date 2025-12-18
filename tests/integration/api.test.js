const request = require('supertest');
const app = require('../../server_lite');

// We might want to mock services to avoid hitting real DBs or APIs during integration tests
// especially since we don't want to start separate servers.
// However, integration tests ideally test the wiring.
// For now, let's mock the skip-service to return predictable results.

jest.mock('../../src/services/skip-service', () => ({
    getAllSegments: jest.fn().mockResolvedValue({
        'tt11111:1:1': [{ start: 0, end: 10 }]
    }),
    getSkipSegment: jest.fn(),
    reportSegment: jest.fn(),
    addSkipSegment: jest.fn(),
    resolveModeration: jest.fn(),
    getPendingModeration: jest.fn()
}));

jest.mock('../../src/services/user-service', () => ({
    getStats: jest.fn().mockResolvedValue({ userCount: 10, voteCount: 50 }),
    getLeaderboard: jest.fn().mockResolvedValue([]),
    getUserStats: jest.fn(),
    updateUserStats: jest.fn()
}));

describe('API Integration', () => {
    it('GET /api/stats should return stats', async () => {
        const res = await request(app).get('/api/stats');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('users');
        expect(res.body).toHaveProperty('skips');
    });

    it('GET /api/catalog should return catalog structure', async () => {
        const res = await request(app).get('/api/catalog');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('media');
    });

    it('GET /manifest.json should return the addon manifest', async () => {
        const res = await request(app).get('/manifest.json');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('id', 'org.introhater.lite');
    });
});
