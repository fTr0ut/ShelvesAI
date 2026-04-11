'use strict';

jest.mock('../database/queries/admin', () => ({
  logAction: jest.fn(),
  getUsersForEmailCampaign: jest.fn(),
  suspendUser: jest.fn(),
}));

jest.mock('../database/queries/moderation', () => ({
  CONTENT_TYPES: ['profile_bio', 'event_comment'],
  STATUS_VALUES: ['active', 'flagged', 'hidden', 'cleared', 'deleted'],
  ACTOR_TYPES: ['human', 'bot'],
  listModerationItems: jest.fn(),
  getModerationItem: jest.fn(),
  getModerationEntity: jest.fn(),
  upsertModerationEntity: jest.fn(),
  getModerationMetrics: jest.fn(),
  resultingStatusForAction: jest.fn(),
  applyMutationForAction: jest.fn(),
  buildSnapshotItem: jest.fn(),
}));

jest.mock('../database/queries/systemSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('../database/queries/deletionRequests', () => ({}));
jest.mock('../database/queries/jobRuns', () => ({}));
jest.mock('../database/queries/workflowQueueJobs', () => ({}));
jest.mock('../database/queries/visionQuota', () => ({}));
jest.mock('../database/queries/adminContent', () => ({}));
jest.mock('../services/config/SystemSettingsCache', () => ({
  getSystemSettingsCache: jest.fn(() => ({ invalidate: jest.fn() })),
}));
jest.mock('../services/processingStatus', () => ({
  getJob: jest.fn(() => null),
}));
jest.mock('../middleware/auth', () => ({
  revokeToken: jest.fn(),
  invalidateAuthCache: jest.fn(),
}));
jest.mock('../services/emailService', () => ({
  sendDeletionApprovedEmail: jest.fn(),
  sendDeletionRejectedEmail: jest.fn(),
  sendModerationActionAlertEmail: jest.fn(),
  sendBulkEmail: jest.fn(),
  getResendAudiences: jest.fn(),
  getResendAudienceContacts: jest.fn(),
}));

const adminQueries = require('../database/queries/admin');
const moderationQueries = require('../database/queries/moderation');
const systemSettingsQueries = require('../database/queries/systemSettings');
const { sendModerationActionAlertEmail } = require('../services/emailService');
const adminController = require('../controllers/adminController');

function makeReq(overrides = {}) {
  return {
    user: { id: 'admin-1', username: 'root' },
    params: {},
    query: {},
    body: {},
    headers: {},
    get: jest.fn(() => 'jest-agent'),
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
    ...overrides,
  };
}

function makeRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  systemSettingsQueries.getSetting.mockResolvedValue({
    key: 'moderation_bot_config',
    value: { mode: 'recommend_only', alertHumanAdmins: true },
  });
  adminQueries.logAction.mockResolvedValue(undefined);
  adminQueries.getUsersForEmailCampaign.mockResolvedValue([{ email: 'admin@example.com' }]);
  moderationQueries.buildSnapshotItem.mockImplementation((item) => item);
  moderationQueries.resultingStatusForAction.mockReturnValue('flagged');
});

describe('adminController.listModerationItems', () => {
  it('returns moderation items with bot config metadata', async () => {
    moderationQueries.listModerationItems.mockResolvedValue({
      items: [{ contentType: 'event_comment', contentId: '55' }],
      nextCursor: 'cursor-2',
      hasMore: true,
    });
    systemSettingsQueries.getSetting.mockResolvedValue({
      key: 'moderation_bot_config',
      value: { mode: 'hybrid', alertHumanAdmins: false },
    });

    const req = makeReq({ query: { limit: '10', status: 'flagged' } });
    const res = makeRes();

    await adminController.listModerationItems(req, res);

    expect(moderationQueries.listModerationItems).toHaveBeenCalledWith({
      limit: 10,
      cursor: null,
      updatedSince: null,
      contentType: null,
      status: 'flagged',
      search: '',
    });
    expect(res.json).toHaveBeenCalledWith({
      items: [{ contentType: 'event_comment', contentId: '55' }],
      pagination: {
        limit: 10,
        nextCursor: 'cursor-2',
        hasMore: true,
      },
      botMode: 'hybrid',
      alertHumanAdmins: false,
    });
  });
});

describe('adminController.applyModerationAction', () => {
  it('records a recommendation without mutating content', async () => {
    const snapshot = {
      contentType: 'profile_bio',
      contentId: 'user-1',
      availableActions: ['clear'],
      authorUserId: 'user-1',
      authorUsername: 'alice',
      title: 'Profile bio for @alice',
      text: 'abusive bio',
      sourceRoute: '/users?selectedUserId=user-1',
      status: 'active',
    };

    moderationQueries.getModerationItem.mockResolvedValue(snapshot);
    moderationQueries.getModerationEntity.mockResolvedValue(null);
    moderationQueries.upsertModerationEntity.mockResolvedValue({ status: 'flagged' });

    const req = makeReq({
      body: {
        contentType: 'profile_bio',
        contentId: 'user-1',
        action: 'clear',
        reason: 'policy.bio_abuse',
        actorType: 'human',
        execute: false,
      },
    });
    const res = makeRes();

    await adminController.applyModerationAction(req, res);

    expect(moderationQueries.applyMutationForAction).not.toHaveBeenCalled();
    expect(moderationQueries.upsertModerationEntity).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'profile_bio',
      contentId: 'user-1',
      status: 'flagged',
      lastAction: 'clear',
      lastActorType: 'human',
      actionReason: 'policy.bio_abuse',
    }));
    expect(sendModerationActionAlertEmail).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      executed: false,
    }));
  });

  it('executes a bot action and sends alert email when autonomous mode is enabled', async () => {
    const snapshot = {
      contentType: 'event_comment',
      contentId: '55',
      availableActions: ['delete'],
      authorUserId: 'user-2',
      authorUsername: 'bob',
      title: 'Comment on item.added',
      text: 'spam comment',
      sourceRoute: '/social-feed?eventId=abc',
      status: 'active',
    };

    systemSettingsQueries.getSetting.mockResolvedValue({
      key: 'moderation_bot_config',
      value: { mode: 'autonomous', alertHumanAdmins: true },
    });
    moderationQueries.getModerationItem.mockResolvedValue(snapshot);
    moderationQueries.getModerationEntity.mockResolvedValue(null);
    moderationQueries.applyMutationForAction.mockResolvedValue({ id: 55 });
    moderationQueries.resultingStatusForAction.mockReturnValue('deleted');
    moderationQueries.upsertModerationEntity.mockResolvedValue({ status: 'deleted' });
    sendModerationActionAlertEmail.mockResolvedValue({ sent: 1, failed: 0 });

    const req = makeReq({
      body: {
        contentType: 'event_comment',
        contentId: '55',
        action: 'delete',
        reason: 'policy.spam',
        ruleCode: 'spam.comment',
        confidence: 0.99,
        actorType: 'bot',
        execute: true,
      },
    });
    const res = makeRes();

    await adminController.applyModerationAction(req, res);

    expect(moderationQueries.applyMutationForAction).toHaveBeenCalledWith({
      action: 'delete',
      snapshot,
      previousState: null,
    });
    expect(adminQueries.logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MODERATION_ACTION_EXECUTED',
      targetUserId: 'user-2',
      metadata: expect.objectContaining({
        contentType: 'event_comment',
        contentId: '55',
        action: 'delete',
        actorType: 'bot',
        executed: true,
      }),
    }));
    expect(sendModerationActionAlertEmail).toHaveBeenCalledWith(
      [{ email: 'admin@example.com' }],
      expect.objectContaining({
        contentType: 'event_comment',
        contentId: '55',
        action: 'delete',
        ruleCode: 'spam.comment',
      })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      executed: true,
      alertResult: { sent: 1, failed: 0 },
    }));
  });

  it('blocks bot execution when recommend_only mode is active', async () => {
    const req = makeReq({
      body: {
        contentType: 'event_comment',
        contentId: '55',
        action: 'delete',
        reason: 'policy.spam',
        actorType: 'bot',
        execute: true,
      },
    });
    const res = makeRes();

    await adminController.applyModerationAction(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Autonomous moderation is disabled by moderation_bot_config',
    });
    expect(moderationQueries.getModerationItem).not.toHaveBeenCalled();
  });
});

describe('adminController.getSystemInfo', () => {
  it('includes moderation metrics and config', async () => {
    moderationQueries.getModerationMetrics.mockResolvedValue({
      counts: { active: 0, flagged: 3, hidden: 1, cleared: 0, deleted: 2 },
      recentBotActions24h: 4,
      lastAlertSentAt: '2026-04-11T20:00:00.000Z',
    });
    systemSettingsQueries.getSetting.mockResolvedValue({
      key: 'moderation_bot_config',
      value: { mode: 'hybrid', alertHumanAdmins: true },
    });

    const req = makeReq();
    const res = makeRes();

    await adminController.getSystemInfo(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      moderation: {
        counts: { active: 0, flagged: 3, hidden: 1, cleared: 0, deleted: 2 },
        recentBotActions24h: 4,
        lastAlertSentAt: '2026-04-11T20:00:00.000Z',
        botMode: 'hybrid',
        alertHumanAdmins: true,
      },
    }));
  });
});
