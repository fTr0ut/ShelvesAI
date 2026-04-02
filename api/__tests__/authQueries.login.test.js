jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(() => '__dummy_hash__'),
  hash: jest.fn(async (value) => `hash:${value}`),
  compare: jest.fn(async (value, hash) => hash !== '__dummy_hash__' && hash === `hash:${value}`),
}), { virtual: true });

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn((payload) => Buffer.from(JSON.stringify(payload)).toString('base64url')),
  verify: jest.fn((token) => JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))),
}), { virtual: true });

jest.mock('../logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logger = require('../logger');
const { query } = require('../database/pg');
const authQueries = require('../database/queries/auth');

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
});

describe('authQueries.findByLoginIdentifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries username and email case-insensitively', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await authQueries.findByLoginIdentifier('Alice@Example.com');

    expect(result).toEqual({ status: 'not_found' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(username) = LOWER($1)'),
      ['Alice@Example.com']
    );
    expect(query.mock.calls[0][0]).toContain('LOWER(email) = LOWER($1)');
  });

  it('returns ambiguous when multiple users share the same login identifier', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'user-1', username: 'shared', email: 'alpha@example.com' },
        { id: 'user-2', username: 'other', email: 'shared' },
      ],
    });

    const result = await authQueries.findByLoginIdentifier('shared');

    expect(result).toEqual({
      status: 'ambiguous',
      users: expect.arrayContaining([
        expect.objectContaining({ id: 'user-1' }),
        expect.objectContaining({ id: 'user-2' }),
      ]),
    });
  });
});

describe('authQueries.login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs in successfully with username', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          username: 'alice',
          email: 'alice@example.com',
          password_hash: passwordHash,
          onboarding_completed: false,
          is_suspended: false,
        },
      ],
    });

    const result = await authQueries.login({ username: 'Alice', password: 'password123' });

    expect(result).toEqual(
      expect.objectContaining({
        user: { id: 'user-1', username: 'alice' },
        token: expect.any(String),
        onboardingCompleted: false,
      })
    );
    const decoded = jwt.verify(result.token, 'test-secret');
    expect(decoded.id).toBe('user-1');
    expect(decoded.username).toBe('alice');
  });

  it('logs in successfully with email using the legacy username field', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-2',
          username: 'bravo',
          email: 'bravo@example.com',
          password_hash: passwordHash,
          onboarding_completed: true,
          is_suspended: false,
        },
      ],
    });

    const result = await authQueries.login({ username: 'BRAVO@EXAMPLE.COM', password: 'password123' });

    expect(result).toEqual(
      expect.objectContaining({
        user: { id: 'user-2', username: 'bravo' },
        token: expect.any(String),
        onboardingCompleted: true,
      })
    );
  });

  it('returns null for an unknown identifier', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await authQueries.login({ username: 'missing@example.com', password: 'password123' });

    expect(result).toBeNull();
  });

  it('returns null for a wrong password', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-3',
          username: 'charlie',
          email: 'charlie@example.com',
          password_hash: passwordHash,
          onboarding_completed: false,
          is_suspended: false,
        },
      ],
    });

    const result = await authQueries.login({ username: 'charlie@example.com', password: 'wrong-password' });

    expect(result).toBeNull();
  });

  it('returns suspended metadata for a suspended user logging in by email', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-4',
          username: 'delta',
          email: 'delta@example.com',
          password_hash: passwordHash,
          onboarding_completed: false,
          is_suspended: true,
          suspension_reason: 'manual review',
        },
      ],
    });

    const result = await authQueries.login({ username: 'delta@example.com', password: 'password123' });

    expect(result).toEqual({
      suspended: true,
      suspensionReason: 'manual review',
    });
  });

  it('returns null and logs a warning for ambiguous identifier collisions', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-5',
          username: 'echo@example.com',
          email: 'echo-owner@example.com',
          password_hash: passwordHash,
          onboarding_completed: false,
          is_suspended: false,
        },
        {
          id: 'user-6',
          username: 'echo',
          email: 'echo@example.com',
          password_hash: passwordHash,
          onboarding_completed: false,
          is_suspended: false,
        },
      ],
    });

    const result = await authQueries.login({ username: 'echo@example.com', password: 'password123' });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'Ambiguous login identifier match rejected',
      expect.objectContaining({
        loginIdentifier: 'echo@example.com',
        matchedUserIds: ['user-5', 'user-6'],
      })
    );
  });
});
