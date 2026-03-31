const { transaction } = require('../database/pg');
const pushDeviceTokens = require('../database/queries/pushDeviceTokens');

describe('pushDeviceTokens.registerToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockTransactionWithClient(clientQuery) {
    transaction.mockImplementationOnce(async (fn) => fn({ query: clientQuery }));
  }

  test('deactivates same-device and legacy active tokens for install-scoped device IDs', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 'u1', expo_push_token: 'ExponentPushToken[new]' }],
      })
      .mockResolvedValueOnce({ rowCount: 2 });
    mockTransactionWithClient(clientQuery);

    const result = await pushDeviceTokens.registerToken('u1', 'ExponentPushToken[new]', {
      deviceId: 'install:abc-123',
      platform: 'ios',
    });

    expect(result).toEqual(expect.objectContaining({
      id: 1,
      userId: 'u1',
      expoPushToken: 'ExponentPushToken[new]',
    }));
    expect(clientQuery).toHaveBeenCalledTimes(2);

    const deactivateSql = clientQuery.mock.calls[1][0];
    const deactivateParams = clientQuery.mock.calls[1][1];
    expect(deactivateSql).toContain('device_id = $3');
    expect(deactivateSql).toContain('device_id IS NULL');
    expect(deactivateSql).toContain("device_id NOT LIKE 'install:%'");
    expect(deactivateParams).toEqual(['u1', 'ExponentPushToken[new]', 'install:abc-123']);
  });

  test('deactivates all other active tokens when deviceId is missing', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 2, user_id: 'u2', expo_push_token: 'ExponentPushToken[token]' }],
      })
      .mockResolvedValueOnce({ rowCount: 3 });
    mockTransactionWithClient(clientQuery);

    await pushDeviceTokens.registerToken('u2', 'ExponentPushToken[token]', {
      platform: 'ios',
    });

    expect(clientQuery).toHaveBeenCalledTimes(2);
    const deactivateSql = clientQuery.mock.calls[1][0];
    const deactivateParams = clientQuery.mock.calls[1][1];
    expect(deactivateSql).toContain('expo_push_token != $2');
    expect(deactivateSql).not.toContain('device_id = $3');
    expect(deactivateParams).toEqual(['u2', 'ExponentPushToken[token]']);
  });

  test('deactivates only matching device rows for non-install device IDs', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 3, user_id: 'u3', expo_push_token: 'ExponentPushToken[token]' }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });
    mockTransactionWithClient(clientQuery);

    await pushDeviceTokens.registerToken('u3', 'ExponentPushToken[token]', {
      deviceId: 'legacy-device-name',
      platform: 'ios',
    });

    expect(clientQuery).toHaveBeenCalledTimes(2);
    const deactivateSql = clientQuery.mock.calls[1][0];
    const deactivateParams = clientQuery.mock.calls[1][1];
    expect(deactivateSql).toContain('device_id = $3');
    expect(deactivateSql).not.toContain('device_id IS NULL');
    expect(deactivateSql).not.toContain("device_id NOT LIKE 'install:%'");
    expect(deactivateParams).toEqual(['u3', 'ExponentPushToken[token]', 'legacy-device-name']);
  });
});
