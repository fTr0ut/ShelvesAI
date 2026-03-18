/**
 * Tests for the shared utility modules introduced in task 010.
 *
 * Covers:
 *   - api/utils/normalize.js
 *   - api/utils/errorHandler.js
 *   - api/database/queries/ownership.js
 *   - api/config/constants.js
 */

// ---------------------------------------------------------------------------
// normalize.js
// ---------------------------------------------------------------------------
const { normalizeString, normalizeStringArray, normalizeTags } = require('../utils/normalize');

describe('normalizeString', () => {
  it('returns null for null', () => expect(normalizeString(null)).toBeNull());
  it('returns null for undefined', () => expect(normalizeString(undefined)).toBeNull());
  it('returns null for empty string', () => expect(normalizeString('')).toBeNull());
  it('returns null for whitespace-only string', () => expect(normalizeString('   ')).toBeNull());
  it('trims leading/trailing whitespace', () => expect(normalizeString('  hello  ')).toBe('hello'));
  it('coerces numbers to strings', () => expect(normalizeString(42)).toBe('42'));
  it('preserves internal content', () => expect(normalizeString('hello world')).toBe('hello world'));
});

describe('normalizeStringArray', () => {
  it('returns empty array for no arguments', () => expect(normalizeStringArray()).toEqual([]));
  it('returns empty array for null/undefined args', () => expect(normalizeStringArray(null, undefined)).toEqual([]));
  it('flattens a single array argument', () =>
    expect(normalizeStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']));
  it('accepts multiple string arguments', () =>
    expect(normalizeStringArray('a', 'b')).toEqual(['a', 'b']));
  it('deduplicates case-insensitively (keeps first occurrence)', () =>
    expect(normalizeStringArray('Apple', 'apple', 'APPLE')).toEqual(['Apple']));
  it('filters out empty/null entries', () =>
    expect(normalizeStringArray('a', '', null, 'b')).toEqual(['a', 'b']));
  it('mixes arrays and scalars', () =>
    expect(normalizeStringArray(['x', 'y'], 'z')).toEqual(['x', 'y', 'z']));
});

describe('normalizeTags', () => {
  it('returns empty array for null', () => expect(normalizeTags(null)).toEqual([]));
  it('returns empty array for undefined', () => expect(normalizeTags(undefined)).toEqual([]));
  it('splits a plain string on whitespace', () =>
    expect(normalizeTags('sci-fi action')).toEqual(['sci-fi', 'action']));
  it('splits a plain string on commas', () =>
    expect(normalizeTags('sci-fi,action')).toEqual(['sci-fi', 'action']));
  it('accepts an array of tags', () =>
    expect(normalizeTags(['sci-fi', 'action'])).toEqual(['sci-fi', 'action']));
  it('deduplicates case-insensitively', () =>
    expect(normalizeTags(['Sci-Fi', 'sci-fi'])).toEqual(['Sci-Fi']));
  it('filters empty entries', () =>
    expect(normalizeTags(['a', '', '  '])).toEqual(['a']));
});

// ---------------------------------------------------------------------------
// errorHandler.js
// ---------------------------------------------------------------------------
const { sendError, logError } = require('../utils/errorHandler');

describe('sendError', () => {
  let res;
  beforeEach(() => {
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  });

  it('sets the correct HTTP status', () => {
    sendError(res, 404, 'Not found');
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('includes the error message in the body', () => {
    sendError(res, 400, 'Bad request');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Bad request' }));
  });

  it('merges extra details into the response body', () => {
    sendError(res, 403, 'Forbidden', { code: 'NO_ACCESS' });
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden', code: 'NO_ACCESS' });
  });
});

describe('logError', () => {
  it('calls console.error without throwing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => logError('testContext', new Error('boom'), { userId: 1 })).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('handles non-Error values gracefully', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => logError('ctx', 'string error')).not.toThrow();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// ownership.js
// ---------------------------------------------------------------------------
const { verifyOwnership, ALLOWED_TABLES } = require('../database/queries/ownership');
// database/pg is mocked globally in setup.js
const { query: mockQuery } = require('../database/pg');

describe('verifyOwnership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws for a table not in the allowlist', async () => {
    await expect(verifyOwnership('users', 1, 1)).rejects.toThrow(/allowlist/);
  });

  it('returns true when the row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const result = await verifyOwnership('shelves', 1, 42);
    expect(result).toBe(true);
  });

  it('returns false when the row does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await verifyOwnership('shelves', 99, 42);
    expect(result).toBe(false);
  });

  it('uses owner_id for shelves', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await verifyOwnership('shelves', 1, 42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('owner_id'),
      [1, 42]
    );
  });

  it('uses user_id for wishlists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await verifyOwnership('wishlists', 1, 42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('user_id'),
      [1, 42]
    );
  });

  it('uses user_id for needs_review', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await verifyOwnership('needs_review', 1, 42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('user_id'),
      [1, 42]
    );
  });

  it('uses a provided transaction client instead of the pool', async () => {
    const clientQuery = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    const client = { query: clientQuery };
    const result = await verifyOwnership('shelves', 1, 42, client);
    expect(result).toBe(true);
    expect(clientQuery).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ALLOWED_TABLES contains the expected tables', () => {
    expect(ALLOWED_TABLES.has('shelves')).toBe(true);
    expect(ALLOWED_TABLES.has('wishlists')).toBe(true);
    expect(ALLOWED_TABLES.has('user_lists')).toBe(true);
    expect(ALLOWED_TABLES.has('needs_review')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// constants.js
// ---------------------------------------------------------------------------
const constants = require('../config/constants');

describe('constants', () => {
  it('exports AUTH_CACHE_TTL_MS as a positive number', () =>
    expect(constants.AUTH_CACHE_TTL_MS).toBeGreaterThan(0));

  it('exports AUTH_CACHE_MAX_ENTRIES as a positive number', () =>
    expect(constants.AUTH_CACHE_MAX_ENTRIES).toBeGreaterThan(0));

  it('exports DEFAULT_OCR_CONFIDENCE_THRESHOLD as 0.7', () =>
    expect(constants.DEFAULT_OCR_CONFIDENCE_THRESHOLD).toBe(0.7));

  it('exports OCR_CONFIDENCE_THRESHOLD between 0 and 1', () => {
    expect(constants.OCR_CONFIDENCE_THRESHOLD).toBeGreaterThanOrEqual(0);
    expect(constants.OCR_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('exports AGGREGATE_WINDOW_MINUTES as a positive number', () =>
    expect(constants.AGGREGATE_WINDOW_MINUTES).toBeGreaterThan(0));

  it('exports PREVIEW_PAYLOAD_LIMIT as a positive number', () =>
    expect(constants.PREVIEW_PAYLOAD_LIMIT).toBeGreaterThan(0));

  it('exports DEFAULT_PAGE_LIMIT as 20', () =>
    expect(constants.DEFAULT_PAGE_LIMIT).toBe(20));

  it('exports MAX_PAGE_LIMIT as 100', () =>
    expect(constants.MAX_PAGE_LIMIT).toBe(100));
});
