jest.mock('../services/pushNotificationService', () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ sent: true }),
}));

const { query } = require('../database/pg');
const pushNotificationService = require('../services/pushNotificationService');
const notificationsQueries = require('../database/queries/notifications');

describe('notificationsQueries.create dedup behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('friend_accept duplicates return null and do not send push', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await notificationsQueries.create({
      userId: 'u1',
      actorId: 'a1',
      type: 'friend_accept',
      entityId: '123',
      entityType: 'friendship',
      metadata: {},
    });

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (user_id, actor_id, entity_id, type)');
    expect(sql).toContain("type = 'friend_accept'");
    expect(pushNotificationService.sendPushNotification).not.toHaveBeenCalled();
  });

  test('workflow duplicates return null and do not send push', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await notificationsQueries.create({
      userId: 'u1',
      actorId: null,
      type: 'workflow_complete',
      entityId: 'wf-job-1',
      entityType: 'workflow_job',
      metadata: {},
    });

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (user_id, entity_id, type)');
    expect(sql).toContain("type IN ('workflow_complete', 'workflow_failed')");
    expect(pushNotificationService.sendPushNotification).not.toHaveBeenCalled();
  });
});
