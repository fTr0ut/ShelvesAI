jest.mock('../database/queries/users', () => ({
  findById: jest.fn(),
  completeOnboardingWithTerms: jest.fn(),
}));

const usersQueries = require('../database/queries/users');
const { CURRENT_TERMS_VERSION } = require('../config/constants');
const { completeOnboarding } = require('../controllers/onboardingController');

function makeReq(overrides = {}) {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
    },
    body: {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function baseUser(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'tester@example.com',
    first_name: 'Test',
    city: 'Boston',
    state: 'MA',
    onboarding_completed: false,
    terms_accepted: false,
    terms_accepted_version: null,
    ...overrides,
  };
}

describe('onboardingController.completeOnboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when required profile fields are missing', async () => {
    usersQueries.findById.mockResolvedValueOnce(baseUser({ city: null }));

    const req = makeReq({ body: { termsAccepted: true, termsVersion: CURRENT_TERMS_VERSION } });
    const res = makeRes();
    await completeOnboarding(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing required fields',
      missingFields: ['city'],
    });
    expect(usersQueries.completeOnboardingWithTerms).not.toHaveBeenCalled();
  });

  it('returns 400 when terms are not accepted yet', async () => {
    usersQueries.findById.mockResolvedValueOnce(baseUser());

    const req = makeReq({ body: {} });
    const res = makeRes();
    await completeOnboarding(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Terms of Service must be accepted',
      requiredTermsVersion: CURRENT_TERMS_VERSION,
    });
  });

  it('returns 400 when submitted terms version does not match active version', async () => {
    usersQueries.findById.mockResolvedValueOnce(baseUser());

    const req = makeReq({
      body: {
        termsAccepted: true,
        termsVersion: '2026-03-01',
      },
    });
    const res = makeRes();
    await completeOnboarding(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Terms version mismatch',
      requiredTermsVersion: CURRENT_TERMS_VERSION,
    });
  });

  it('completes onboarding and persists terms metadata when accepted', async () => {
    usersQueries.findById.mockResolvedValueOnce(baseUser());
    usersQueries.completeOnboardingWithTerms.mockResolvedValueOnce(baseUser({
      onboarding_completed: true,
      terms_accepted: true,
      terms_accepted_version: CURRENT_TERMS_VERSION,
      terms_accepted_at: '2026-03-30T16:00:00.000Z',
    }));

    const req = makeReq({
      body: {
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      },
    });
    const res = makeRes();
    await completeOnboarding(req, res);

    expect(usersQueries.completeOnboardingWithTerms).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      CURRENT_TERMS_VERSION
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      onboardingCompleted: true,
      user: expect.objectContaining({
        onboardingCompleted: true,
        termsAccepted: true,
        termsAcceptedVersion: CURRENT_TERMS_VERSION,
      }),
    }));
  });

  it('returns success without updating when user is already complete on current terms', async () => {
    usersQueries.findById.mockResolvedValueOnce(baseUser({
      onboarding_completed: true,
      terms_accepted: true,
      terms_accepted_version: CURRENT_TERMS_VERSION,
    }));

    const req = makeReq({ body: {} });
    const res = makeRes();
    await completeOnboarding(req, res);

    expect(usersQueries.completeOnboardingWithTerms).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      onboardingCompleted: true,
      user: expect.objectContaining({
        onboardingCompleted: true,
        termsAccepted: true,
        termsAcceptedVersion: CURRENT_TERMS_VERSION,
      }),
    }));
  });
});

