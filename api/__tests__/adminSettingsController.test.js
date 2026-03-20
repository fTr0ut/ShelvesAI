'use strict';

/**
 * Tests for admin settings controller functions:
 *   getSettings, getSetting, updateSetting
 */

jest.mock('../database/queries/systemSettings');
jest.mock('../database/queries/admin');
jest.mock('../services/config/SystemSettingsCache');

const systemSettingsQueries = require('../database/queries/systemSettings');
const adminQueries = require('../database/queries/admin');
const { getSystemSettingsCache } = require('../services/config/SystemSettingsCache');
const adminController = require('../controllers/adminController');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    user: { id: 42 },
    params: {},
    body: {},
    headers: {},
    get: jest.fn().mockReturnValue(null),
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
    ...overrides,
  };
}

const mockInvalidate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  getSystemSettingsCache.mockReturnValue({ invalidate: mockInvalidate });
  adminQueries.logAction = jest.fn().mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// getSettings
// ---------------------------------------------------------------------------

describe('adminController.getSettings()', () => {
  it('returns all settings wrapped in { settings }', async () => {
    const rows = [
      { key: 'a', value: 1, description: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date() },
      { key: 'b', value: 'hello', description: 'desc', updatedBy: 1, createdAt: new Date(), updatedAt: new Date() },
    ];
    systemSettingsQueries.getAllSettings.mockResolvedValue(rows);

    const req = makeReq();
    const res = makeRes();

    await adminController.getSettings(req, res);

    expect(systemSettingsQueries.getAllSettings).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ settings: rows });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    systemSettingsQueries.getAllSettings.mockRejectedValue(new Error('DB down'));

    const req = makeReq();
    const res = makeRes();

    await adminController.getSettings(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });
});

// ---------------------------------------------------------------------------
// getSetting
// ---------------------------------------------------------------------------

describe('adminController.getSetting()', () => {
  it('returns the setting wrapped in { setting } when found', async () => {
    const row = { key: 'foo', value: { x: 1 }, description: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date() };
    systemSettingsQueries.getSetting.mockResolvedValue(row);

    const req = makeReq({ params: { key: 'foo' } });
    const res = makeRes();

    await adminController.getSetting(req, res);

    expect(systemSettingsQueries.getSetting).toHaveBeenCalledWith('foo');
    expect(res.json).toHaveBeenCalledWith({ setting: row });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 404 when setting is not found', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(null);

    const req = makeReq({ params: { key: 'missing' } });
    const res = makeRes();

    await adminController.getSetting(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Setting not found' });
  });

  it('returns 500 on unexpected error', async () => {
    systemSettingsQueries.getSetting.mockRejectedValue(new Error('DB down'));

    const req = makeReq({ params: { key: 'foo' } });
    const res = makeRes();

    await adminController.getSetting(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });
});

// ---------------------------------------------------------------------------
// updateSetting
// ---------------------------------------------------------------------------

describe('adminController.updateSetting()', () => {
  const existingRow = { key: 'cfg', value: { old: true }, description: 'Old desc', updatedBy: 1, createdAt: new Date(), updatedAt: new Date() };
  const updatedRow = { key: 'cfg', value: { new: true }, description: 'Old desc', updatedBy: 42, createdAt: new Date(), updatedAt: new Date() };

  it('returns 400 when value is missing from body', async () => {
    const req = makeReq({ params: { key: 'cfg' }, body: {} });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'value is required' });
    expect(systemSettingsQueries.upsertSetting).not.toHaveBeenCalled();
  });

  it('accepts falsy values (false, 0, null, empty string) as valid', async () => {
    for (const val of [false, 0, null, '']) {
      jest.clearAllMocks();
      getSystemSettingsCache.mockReturnValue({ invalidate: mockInvalidate });
      adminQueries.logAction = jest.fn().mockResolvedValue(undefined);

      systemSettingsQueries.getSetting.mockResolvedValue(existingRow);
      systemSettingsQueries.upsertSetting.mockResolvedValue({ ...updatedRow, value: val });

      const req = makeReq({ params: { key: 'cfg' }, body: { value: val } });
      const res = makeRes();

      await adminController.updateSetting(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ setting: expect.objectContaining({ value: val }) });
    }
  });

  it('upserts the setting and returns { setting }', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(existingRow);
    systemSettingsQueries.upsertSetting.mockResolvedValue(updatedRow);

    const req = makeReq({ params: { key: 'cfg' }, body: { value: { new: true } } });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(systemSettingsQueries.upsertSetting).toHaveBeenCalledWith(
      'cfg',
      { new: true },
      expect.objectContaining({ updatedBy: 42 })
    );
    expect(res.json).toHaveBeenCalledWith({ setting: updatedRow });
  });

  it('invalidates the cache after a successful write', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(existingRow);
    systemSettingsQueries.upsertSetting.mockResolvedValue(updatedRow);

    const req = makeReq({ params: { key: 'cfg' }, body: { value: 42 } });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(mockInvalidate).toHaveBeenCalledWith('cfg');
  });

  it('logs the admin action with previous value', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(existingRow);
    systemSettingsQueries.upsertSetting.mockResolvedValue(updatedRow);

    const req = makeReq({ params: { key: 'cfg' }, body: { value: { new: true } } });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(adminQueries.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 42,
        action: 'update_setting',
        targetUserId: null,
        metadata: { key: 'cfg', previousValue: existingRow.value },
      })
    );
  });

  it('logs previousValue as null when setting did not previously exist', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(null);
    systemSettingsQueries.upsertSetting.mockResolvedValue(updatedRow);

    const req = makeReq({ params: { key: 'new_key' }, body: { value: 'hello' } });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(adminQueries.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { key: 'new_key', previousValue: null },
      })
    );
  });

  it('preserves existing description when none is provided in body', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(existingRow);
    systemSettingsQueries.upsertSetting.mockResolvedValue(updatedRow);

    const req = makeReq({ params: { key: 'cfg' }, body: { value: 1 } });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(systemSettingsQueries.upsertSetting).toHaveBeenCalledWith(
      'cfg',
      1,
      expect.objectContaining({ description: 'Old desc' })
    );
  });

  it('uses provided description when given in body', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(existingRow);
    systemSettingsQueries.upsertSetting.mockResolvedValue(updatedRow);

    const req = makeReq({ params: { key: 'cfg' }, body: { value: 1, description: 'New desc' } });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(systemSettingsQueries.upsertSetting).toHaveBeenCalledWith(
      'cfg',
      1,
      expect.objectContaining({ description: 'New desc' })
    );
  });

  it('does not invalidate cache or log if upsert throws', async () => {
    systemSettingsQueries.getSetting.mockResolvedValue(existingRow);
    systemSettingsQueries.upsertSetting.mockRejectedValue(new Error('DB error'));

    const req = makeReq({ params: { key: 'cfg' }, body: { value: 1 } });
    const res = makeRes();

    await adminController.updateSetting(req, res);

    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(adminQueries.logAction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });
});
