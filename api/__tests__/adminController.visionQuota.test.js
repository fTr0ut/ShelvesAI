jest.mock('../database/queries/admin', () => ({
  toggleUnlimitedVisionTokens: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  revokeToken: jest.fn(),
  invalidateAuthCache: jest.fn(),
}));

jest.mock('../database/queries/visionQuota', () => ({}));
jest.mock('../database/queries/systemSettings', () => ({}));
jest.mock('../database/queries/jobRuns', () => ({}));
jest.mock('../database/queries/workflowQueueJobs', () => ({}));
jest.mock('../services/config/SystemSettingsCache', () => ({
  getSystemSettingsCache: jest.fn(() => ({ invalidate: jest.fn() })),
}));
jest.mock('../database/queries/adminContent', () => ({}));
jest.mock('../services/processingStatus', () => ({
  getJob: jest.fn(() => null),
}));

const adminQueries = require('../database/queries/admin');
const { invalidateAuthCache } = require('../middleware/auth');
const { toggleUnlimitedVisionTokens } = require('../controllers/adminController');

function makeReq(overrides = {}) {
  return {
    params: { userId: 'user-1' },
    user: { id: 'admin-1' },
    headers: {},
    get: jest.fn(() => 'jest-agent'),
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
    app: { get: jest.fn(() => false) },
    ...overrides,
  };
}

function makeRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('adminController.toggleUnlimitedVisionTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the updated user and invalidates auth cache on success', async () => {
    adminQueries.toggleUnlimitedVisionTokens.mockResolvedValue({
      user: {
        id: 'user-1',
        username: 'collector',
        unlimitedVisionTokens: true,
      },
    });

    const req = makeReq();
    const res = makeRes();

    await toggleUnlimitedVisionTokens(req, res);

    expect(adminQueries.toggleUnlimitedVisionTokens).toHaveBeenCalledWith(
      'user-1',
      'admin-1',
      expect.objectContaining({
        ipAddress: '127.0.0.1',
        userAgent: 'jest-agent',
      }),
    );
    expect(invalidateAuthCache).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'user-1',
        username: 'collector',
        unlimitedVisionTokens: true,
      },
      message: 'User granted unlimited vision tokens',
    });
  });
});
