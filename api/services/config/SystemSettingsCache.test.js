'use strict';

const { SystemSettingsCache, getSystemSettingsCache } = require('./SystemSettingsCache');

// ---------------------------------------------------------------------------
// SystemSettingsCache — basic get/cache behavior
// ---------------------------------------------------------------------------

describe('SystemSettingsCache.get()', () => {
    it('calls queryFn on cache miss and returns value', async () => {
        const queryFn = jest.fn().mockResolvedValue({ key: 'foo', value: { bar: 1 } });
        const cache = new SystemSettingsCache({ queryFn });

        const result = await cache.get('foo');

        expect(queryFn).toHaveBeenCalledWith('foo');
        expect(result).toEqual({ bar: 1 });
    });

    it('returns null when queryFn returns null (key not found)', async () => {
        const queryFn = jest.fn().mockResolvedValue(null);
        const cache = new SystemSettingsCache({ queryFn });

        const result = await cache.get('missing');

        expect(result).toBeNull();
    });

    it('returns cached value on second call without hitting queryFn again', async () => {
        const queryFn = jest.fn().mockResolvedValue({ key: 'foo', value: 42 });
        const cache = new SystemSettingsCache({ queryFn });

        await cache.get('foo');
        const result = await cache.get('foo');

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(result).toBe(42);
    });

    it('re-fetches after TTL expires', async () => {
        const queryFn = jest.fn()
            .mockResolvedValueOnce({ key: 'foo', value: 'first' })
            .mockResolvedValueOnce({ key: 'foo', value: 'second' });

        const cache = new SystemSettingsCache({ queryFn, ttlMs: 1 }); // 1ms TTL

        await cache.get('foo');
        // Wait for TTL to expire
        await new Promise((resolve) => setTimeout(resolve, 5));
        const result = await cache.get('foo');

        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(result).toBe('second');
    });

    it('caches null values (key not found) to avoid repeated DB hits', async () => {
        const queryFn = jest.fn().mockResolvedValue(null);
        const cache = new SystemSettingsCache({ queryFn });

        await cache.get('missing');
        await cache.get('missing');

        expect(queryFn).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// SystemSettingsCache.invalidate()
// ---------------------------------------------------------------------------

describe('SystemSettingsCache.invalidate()', () => {
    it('invalidates a specific key so next get re-fetches', async () => {
        const queryFn = jest.fn()
            .mockResolvedValueOnce({ key: 'foo', value: 'v1' })
            .mockResolvedValueOnce({ key: 'foo', value: 'v2' });
        const cache = new SystemSettingsCache({ queryFn });

        await cache.get('foo');
        cache.invalidate('foo');
        const result = await cache.get('foo');

        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(result).toBe('v2');
    });

    it('invalidates all keys when called without argument', async () => {
        const queryFn = jest.fn()
            .mockResolvedValue({ key: 'any', value: 'val' });
        const cache = new SystemSettingsCache({ queryFn });

        await cache.get('a');
        await cache.get('b');
        cache.invalidate(); // clear all
        await cache.get('a');
        await cache.get('b');

        expect(queryFn).toHaveBeenCalledTimes(4);
    });

    it('does not affect other keys when invalidating a specific key', async () => {
        const queryFn = jest.fn()
            .mockResolvedValue({ key: 'any', value: 'val' });
        const cache = new SystemSettingsCache({ queryFn });

        await cache.get('a');
        await cache.get('b');
        cache.invalidate('a');
        await cache.get('a'); // re-fetches
        await cache.get('b'); // still cached

        expect(queryFn).toHaveBeenCalledTimes(3); // a, b, a again
    });
});

// ---------------------------------------------------------------------------
// SystemSettingsCache — singleton
// ---------------------------------------------------------------------------

describe('getSystemSettingsCache() singleton', () => {
    it('returns the same instance on repeated calls', () => {
        const a = getSystemSettingsCache();
        const b = getSystemSettingsCache();
        expect(a).toBe(b);
    });

    it('returns a SystemSettingsCache instance', () => {
        expect(getSystemSettingsCache()).toBeInstanceOf(SystemSettingsCache);
    });
});
