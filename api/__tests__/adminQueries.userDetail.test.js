const { query } = require('../database/pg');
const adminQueries = require('../database/queries/admin');

describe('adminQueries.getUserById', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns unlimitedVisionTokens and premiumLockedByAdmin in the camelCase payload', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'user-1',
        username: 'collector',
        email: 'collector@example.com',
        first_name: 'Casey',
        last_name: 'Collector',
        picture: null,
        bio: null,
        city: 'Boston',
        state: 'MA',
        country: 'US',
        is_admin: false,
        is_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        is_private: false,
        is_premium: true,
        premium_locked_by_admin: true,
        unlimited_vision_tokens: true,
        onboarding_completed: true,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-02T00:00:00.000Z',
        shelf_count: '4',
        collection_count: '18',
        friend_count: '6',
      }],
    });

    const user = await adminQueries.getUserById('user-1');

    expect(user).toEqual(expect.objectContaining({
      id: 'user-1',
      premiumLockedByAdmin: true,
      unlimitedVisionTokens: true,
      isPremium: true,
    }));
  });
});
