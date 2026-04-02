jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}), { virtual: true });

jest.mock('../database/queries/auth', () => ({
  login: jest.fn(),
}));

jest.mock('../database/queries/passwordReset', () => ({
  createResetToken: jest.fn(),
  resetPassword: jest.fn(),
  validateResetToken: jest.fn(),
}));

jest.mock('../services/emailService', () => ({
  sendPasswordResetEmail: jest.fn(),
}));

jest.mock('../utils/adminAuth', () => ({
  setAdminAuthCookies: jest.fn(),
}));

jest.mock('../logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const authQueries = require('../database/queries/auth');
const { login } = require('../controllers/authController');

function makeRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('authController.login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('trims the username field before attempting username-or-email login', async () => {
    authQueries.login.mockResolvedValueOnce({
      user: { id: 'user-1', username: 'alice' },
      token: 'token-123',
      onboardingCompleted: true,
    });
    const req = {
      body: {
        username: '  alice@example.com  ',
        password: 'password123',
      },
    };
    const res = makeRes();

    await login(req, res);

    expect(authQueries.login).toHaveBeenCalledWith({
      username: 'alice@example.com',
      password: 'password123',
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'token-123',
      })
    );
  });

  it('returns 400 when the username field is whitespace-only after trimming', async () => {
    const req = {
      body: {
        username: '   ',
        password: 'password123',
      },
    };
    const res = makeRes();

    await login(req, res);

    expect(authQueries.login).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing credentials' });
  });

  it('returns 400 when credentials are invalid', async () => {
    authQueries.login.mockResolvedValueOnce(null);
    const req = {
      body: {
        username: 'missing@example.com',
        password: 'password123',
      },
    };
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid credentials' });
  });

  it('returns 403 for suspended users', async () => {
    authQueries.login.mockResolvedValueOnce({
      suspended: true,
      suspensionReason: 'manual review',
    });
    const req = {
      body: {
        username: 'suspended@example.com',
        password: 'password123',
      },
    };
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Account suspended',
      code: 'ACCOUNT_SUSPENDED',
      reason: 'manual review',
    });
  });
});
