/**
 * Tests for POST /api/auth/refresh
 *
 * Covers:
 * - Valid token → issues new token
 * - Recently-expired token within grace period → issues new token
 * - Token expired beyond grace period → 401
 * - Invalid/tampered token → 401
 * - Missing Authorization header → 401
 * - Suspended user → 403
 * - User not found → 401
 */

const jwt = require('jsonwebtoken');
const { refresh } = require('../controllers/authController');
const { query } = require('../database/pg');

// database/pg is mocked globally by __tests__/setup.js

const SECRET = 'test-secret';

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

function makeRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function makeReq(token) {
  return {
    headers: token
      ? { authorization: `Bearer ${token}` }
      : {},
  };
}

function signToken(payload, options = {}) {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', ...options });
}

describe('authController.refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeReq(null);
    const res = makeRes();
    await refresh(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing token' }));
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = jwt.sign({ id: 1, username: 'alice' }, 'wrong-secret', {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    const req = makeReq(token);
    const res = makeRes();
    await refresh(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid token' }));
  });

  it('returns 401 for a token expired beyond the grace period', async () => {
    // Expired 10 minutes ago (grace is 5 minutes)
    const token = signToken({ id: 1, username: 'alice' }, { expiresIn: -10 * 60 });
    const req = makeReq(token);
    const res = makeRes();
    await refresh(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Token too old to refresh' })
    );
  });

  it('issues a new token for a valid (non-expired) token', async () => {
    const token = signToken({ id: 42, username: 'alice' }, { expiresIn: '1h' });
    query.mockResolvedValueOnce({
      rows: [{ id: 42, username: 'alice', is_suspended: false }],
    });

    const req = makeReq(token);
    const res = makeRes();
    await refresh(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.any(String) })
    );

    // Verify the new token is a valid JWT with the correct user id
    const newToken = res.json.mock.calls[0][0].token;
    const decoded = jwt.verify(newToken, SECRET);
    expect(decoded.id).toBe(42);
    expect(decoded.username).toBe('alice');
  });

  it('issues a new token for a recently-expired token within the grace period', async () => {
    // Expired 2 minutes ago (within 5-minute grace)
    const token = signToken({ id: 7, username: 'bob' }, { expiresIn: -2 * 60 });
    query.mockResolvedValueOnce({
      rows: [{ id: 7, username: 'bob', is_suspended: false }],
    });

    const req = makeReq(token);
    const res = makeRes();
    await refresh(req, res);

    expect(res.status).not.toHaveBeenCalled();
    const newToken = res.json.mock.calls[0][0].token;
    const decoded = jwt.verify(newToken, SECRET);
    expect(decoded.id).toBe(7);
  });

  it('returns 403 when the user is suspended', async () => {
    const token = signToken({ id: 99, username: 'suspended_user' }, { expiresIn: '1h' });
    query.mockResolvedValueOnce({
      rows: [{ id: 99, username: 'suspended_user', is_suspended: true }],
    });

    const req = makeReq(token);
    const res = makeRes();
    await refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ACCOUNT_SUSPENDED' })
    );
  });

  it('returns 401 when the user no longer exists in the database', async () => {
    const token = signToken({ id: 999, username: 'ghost' }, { expiresIn: '1h' });
    query.mockResolvedValueOnce({ rows: [] });

    const req = makeReq(token);
    const res = makeRes();
    await refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'User not found' }));
  });
});
