const hlsProxy = require('../../src/services/hls-proxy');
const axios = require('axios');
const child_process = require('child_process');
const { EventEmitter } = require('events');

jest.mock('axios');
jest.mock('child_process');

describe('HLS Proxy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('generateSmartManifest', () => {
        it('should generate a valid m3u8 playlist with correct offsets', () => {
            const m3u8 = hlsProxy.generateSmartManifest('http://video.mp4', 3600, 1000, 5000, 0);

            expect(m3u8).toContain('#EXT-X-TARGETDURATION:3600');
            expect(m3u8).toContain('#EXT-X-BYTERANGE:1000000@0'); // Header
            expect(m3u8).toContain('#EXT-X-BYTERANGE:4000@1000'); // Body (5000 - 1000)
            expect(m3u8).toContain('http://video.mp4');
        });
    });

    describe('getStreamDetails (Mocked Axios)', () => {
        it('should return final URL and content length on success', async () => {
            axios.head.mockResolvedValue({
                request: { res: { responseUrl: 'http://final.mp4' } },
                headers: { 'content-length': '123456' }
            });

            const details = await hlsProxy.getStreamDetails('http://orig.mp4');
            expect(details).toEqual({ finalUrl: 'http://final.mp4', contentLength: 123456 });
        });

        it('should gracefully handle 404s/network errors', async () => {
            axios.head.mockRejectedValue(new Error('Network Error'));

            const details = await hlsProxy.getStreamDetails('http://orig.mp4');
            // Should fallback to original URL and null length
            expect(details).toEqual({ finalUrl: 'http://orig.mp4', contentLength: null });
        });
    });

    // Note: getByteOffset uses spawn, which is harder to mock robustly in a unit test 
    // without effectively testing the mock itself. We will skim it or mock basic output.
    describe('getByteOffset (Mocked FFprobe)', () => {
        it('should return 0 if ffprobe fails', async () => {
            const mockProc = new EventEmitter();
            mockProc.stdout = new EventEmitter();
            mockProc.stderr = new EventEmitter();
            child_process.spawn.mockReturnValue(mockProc);

            const promise = hlsProxy.getByteOffset('http://vid.mp4', 10);

            // Emit fail
            setTimeout(() => {
                mockProc.emit('close', 1); // code 1
            }, 10);

            const result = await promise;
            expect(result).toBe(0);
        });
    });
});
