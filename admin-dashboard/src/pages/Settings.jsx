import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSettings, updateSetting } from '../api/client';
import { getErrorMessage } from '../utils/errorUtils';

const VALID_SETTING_KEY = /^[a-z][a-z0-9_]{0,99}$/;

const VISION_SETTINGS = [
  { key: 'vision_enabled', label: 'Vision Enabled', type: 'boolean', description: 'Enable or disable the vision scanning feature globally' },
  { key: 'vision_monthly_quota', label: 'Monthly Vision Quota', type: 'number', description: 'Maximum number of vision scans per user per month' },
];

const DEFAULT_MODERATION_BOT_CONFIG = {
  mode: 'recommend_only',
  alertHumanAdmins: true,
};

export default function Settings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [moderationMode, setModerationMode] = useState(DEFAULT_MODERATION_BOT_CONFIG.mode);
  const [alertHumanAdmins, setAlertHumanAdmins] = useState(DEFAULT_MODERATION_BOT_CONFIG.alertHumanAdmins);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      setError(null);
      const response = await getSettings();
      setSettings(response.data.settings);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }

  function getSettingValue(key) {
    const setting = settings.find(s => s.key === key);
    return setting?.value ?? null;
  }

  async function handleVisionToggle(key, currentValue, type) {
    try {
      setSaving(key);
      setError(null);
      let newValue;
      if (type === 'boolean') {
        newValue = !currentValue;
      } else {
        return;
      }
      const desc = VISION_SETTINGS.find(v => v.key === key)?.description || '';
      await updateSetting(key, newValue, desc);
      await loadSettings();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update setting'));
    } finally {
      setSaving(null);
    }
  }

  async function handleVisionNumberSave(key, value) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) {
      setError('Value must be a positive number');
      return;
    }
    try {
      setSaving(key);
      setError(null);
      const desc = VISION_SETTINGS.find(v => v.key === key)?.description || '';
      await updateSetting(key, num, desc);
      await loadSettings();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update setting'));
    } finally {
      setSaving(null);
    }
  }

  async function handleEditSave(key) {
    try {
      let parsedValue;
      try {
        parsedValue = JSON.parse(editValue);
      } catch {
        setError('Value must be valid JSON');
        return;
      }
      setSaving(key);
      setError(null);
      await updateSetting(key, parsedValue, editDesc || undefined);
      await loadSettings();
      setEditingKey(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update setting'));
    } finally {
      setSaving(null);
    }
  }

  async function handleNewSetting() {
    if (!VALID_SETTING_KEY.test(newKey)) {
      setError('Key must be lowercase alphanumeric with underscores, starting with a letter');
      return;
    }
    let parsedValue;
    try {
      parsedValue = JSON.parse(newValue);
    } catch {
      setError('Value must be valid JSON');
      return;
    }
    try {
      setSaving('new');
      setError(null);
      await updateSetting(newKey, parsedValue, newDesc || undefined);
      await loadSettings();
      setShowNewForm(false);
      setNewKey('');
      setNewValue('');
      setNewDesc('');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create setting'));
    } finally {
      setSaving(null);
    }
  }

  const visionQuotaValue = getSettingValue('vision_monthly_quota');
  const moderationBotConfig = {
    ...DEFAULT_MODERATION_BOT_CONFIG,
    ...(getSettingValue('moderation_bot_config') || {}),
  };
  const [quotaInput, setQuotaInput] = useState('');

  useEffect(() => {
    if (visionQuotaValue !== null) {
      setQuotaInput(String(visionQuotaValue));
    }
  }, [visionQuotaValue]);

  useEffect(() => {
    setModerationMode(moderationBotConfig.mode);
    setAlertHumanAdmins(moderationBotConfig.alertHumanAdmins !== false);
  }, [moderationBotConfig.mode, moderationBotConfig.alertHumanAdmins]);

  async function handleModerationConfigSave() {
    try {
      setSaving('moderation_bot_config');
      setError(null);
      await updateSetting(
        'moderation_bot_config',
        {
          mode: moderationMode,
          alertHumanAdmins,
        },
        'Controls moderation bot execution mode and admin alert behavior'
      );
      await loadSettings();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update moderation bot config'));
    } finally {
      setSaving(null);
    }
  }

  const nonVisionSettings = settings.filter(
    (s) => !VISION_SETTINGS.some(v => v.key === s.key) && s.key !== 'moderation_bot_config'
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Vision Configuration */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Vision Configuration</h3>
          <p className="mt-1 text-sm text-gray-500">Control the vision scanning feature for all users</p>

          {loading ? (
            <div className="mt-4 text-gray-500">Loading...</div>
          ) : (
            <div className="mt-5 space-y-4">
              {/* Vision Enabled Toggle */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <div className="text-sm font-medium text-gray-700">Vision Enabled</div>
                  <div className="text-xs text-gray-500">Enable or disable the vision scanning feature globally</div>
                </div>
                <button
                  onClick={() => handleVisionToggle('vision_enabled', getSettingValue('vision_enabled'), 'boolean')}
                  disabled={saving === 'vision_enabled'}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${getSettingValue('vision_enabled') ? 'bg-blue-600' : 'bg-gray-200'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${getSettingValue('vision_enabled') ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Monthly Quota */}
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-gray-700">Monthly Vision Quota</div>
                  <div className="text-xs text-gray-500">Maximum scans per user per month (env default: 15)</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={quotaInput}
                    onChange={(e) => setQuotaInput(e.target.value)}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                  />
                  <button
                    onClick={() => handleVisionNumberSave('vision_monthly_quota', quotaInput)}
                    disabled={saving === 'vision_monthly_quota'}
                    className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving === 'vision_monthly_quota' ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Moderation Bot</h3>
          <p className="mt-1 text-sm text-gray-500">Control whether the moderation bot can recommend or execute actions.</p>

          {loading ? (
            <div className="mt-4 text-gray-500">Loading...</div>
          ) : (
            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <label className="text-sm text-gray-700">
                <span className="block mb-1 font-medium">Mode</span>
                <select
                  value={moderationMode}
                  onChange={(e) => setModerationMode(e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                >
                  <option value="recommend_only">recommend_only</option>
                  <option value="hybrid">hybrid</option>
                  <option value="autonomous">autonomous</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={alertHumanAdmins}
                  onChange={(e) => setAlertHumanAdmins(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Alert human admins when bot executes actions
              </label>
              <button
                onClick={handleModerationConfigSave}
                disabled={saving === 'moderation_bot_config'}
                className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving === 'moderation_bot_config' ? 'Saving...' : 'Save Moderation Config'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* All System Settings */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg leading-6 font-medium text-gray-900">System Settings</h3>
              <p className="mt-1 text-sm text-gray-500">All configurable system settings</p>
            </div>
            <button
              onClick={() => setShowNewForm(!showNewForm)}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              {showNewForm ? 'Cancel' : 'Add Setting'}
            </button>
          </div>

          {showNewForm && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600">Key</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="my_setting_key"
                  className="mt-1 w-full px-3 py-1.5 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">Value (JSON)</label>
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder='true, 42, "hello", or {"key": "value"}'
                  className="mt-1 w-full px-3 py-1.5 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">Description (optional)</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What this setting controls"
                  className="mt-1 w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                />
              </div>
              <button
                onClick={handleNewSetting}
                disabled={saving === 'new'}
                className="px-4 py-2 text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {saving === 'new' ? 'Creating...' : 'Create Setting'}
              </button>
            </div>
          )}

          {loading ? (
            <div className="mt-4 text-gray-500">Loading...</div>
          ) : nonVisionSettings.length === 0 && !showNewForm ? (
            <div className="mt-4 text-sm text-gray-500">No custom settings configured yet.</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {nonVisionSettings.map((setting) => (
                    <tr key={setting.key}>
                      <td className="px-4 py-3 text-sm font-mono text-gray-900">{setting.key}</td>
                      <td className="px-4 py-3 text-sm">
                        {editingKey === setting.key ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                          />
                        ) : (
                          <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                            {JSON.stringify(setting.value)}
                          </code>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {editingKey === setting.key ? (
                          <input
                            type="text"
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                        ) : (
                          setting.description || '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {setting.updatedAt ? new Date(setting.updatedAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingKey === setting.key ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => handleEditSave(setting.key)}
                              disabled={saving === setting.key}
                              className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingKey(null)}
                              className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingKey(setting.key);
                              setEditValue(JSON.stringify(setting.value));
                              setEditDesc(setting.description || '');
                            }}
                            className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Admin Account */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Admin Account</h3>
          <div className="mt-5 border-t border-gray-200 pt-5">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">Username</dt>
                <dd className="mt-1 text-sm text-gray-900">{user?.username || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">User ID</dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono text-xs">{user?.id || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">API URL</dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono text-xs">
                  {import.meta.env.VITE_API_URL || '/api (proxied)'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Dashboard Version</dt>
                <dd className="mt-1 text-sm text-gray-900">2.0.0</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-yellow-800">Admin Setup Reminder</h3>
        <p className="mt-2 text-sm text-yellow-700">
          To grant admin privileges to a user, run this command on the server:
        </p>
        <code className="mt-2 block bg-yellow-100 p-2 rounded text-xs text-yellow-900">
          cd api && node scripts/create-admin.js user@example.com
        </code>
      </div>
    </div>
  );
}
