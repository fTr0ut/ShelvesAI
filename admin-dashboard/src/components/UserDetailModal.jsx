import { useState, useEffect } from 'react';
import {
  getUser, suspendUser, unsuspendUser, toggleAdmin, togglePremium, toggleUnlimitedVisionTokens,
  getUserVisionQuota, resetUserVisionQuota, setUserVisionQuota,
} from '../api/client';
import UserAvatar from './UserAvatar';
import UserBadge from './UserBadge';
import { getErrorMessage } from '../utils/errorUtils';

export default function UserDetailModal({ userId, onClose, onUpdate }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [error, setError] = useState(null);
  const [quota, setQuota] = useState(null);
  const [quotaScansInput, setQuotaScansInput] = useState('');
  const [quotaTokensInput, setQuotaTokensInput] = useState('');
  const [quotaOutputTokensInput, setQuotaOutputTokensInput] = useState('');
  const [showQuotaForm, setShowQuotaForm] = useState(false);

  useEffect(() => {
    if (userId) {
      loadUser();
      loadQuota();
    }
  }, [userId]);

  async function loadUser({ showLoading = true } = {}) {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      const response = await getUser(userId);
      setUser(response.data.user);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load user'));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  async function loadQuota() {
    try {
      const response = await getUserVisionQuota(userId);
      setQuota(response.data.quota);
    } catch (_err) {
      setQuota(null);
      // Non-critical — quota may not exist yet
    }
  }

  async function refreshUserAndQuota() {
    await Promise.all([
      loadUser({ showLoading: false }),
      loadQuota(),
    ]);
  }

  async function handleSuspend() {
    try {
      setError(null);
      setActionLoading(true);
      await suspendUser(userId, suspendReason);
      await refreshUserAndQuota();
      setShowSuspendForm(false);
      setSuspendReason('');
      onUpdate?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to suspend user'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUnsuspend() {
    if (!confirm('Are you sure you want to unsuspend this user?')) return;
    try {
      setError(null);
      setActionLoading(true);
      await unsuspendUser(userId);
      await refreshUserAndQuota();
      onUpdate?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to unsuspend user'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleAdmin() {
    if (!confirm(`Are you sure you want to ${user?.isAdmin ? 'remove' : 'grant'} admin privileges?`)) return;
    try {
      setError(null);
      setActionLoading(true);
      await toggleAdmin(userId);
      await refreshUserAndQuota();
      onUpdate?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update admin status'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTogglePremium() {
    if (!confirm(`Are you sure you want to ${user?.isPremium ? 'remove' : 'grant'} premium status? This will lock the setting so the user cannot change it.`)) return;
    try {
      setError(null);
      setActionLoading(true);
      await togglePremium(userId);
      await refreshUserAndQuota();
      onUpdate?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update premium status'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleUnlimitedVision() {
    if (!confirm(`Are you sure you want to ${user?.unlimitedVisionTokens ? 'remove' : 'grant'} unlimited vision tokens?`)) return;
    try {
      setError(null);
      setActionLoading(true);
      await toggleUnlimitedVisionTokens(userId);
      await refreshUserAndQuota();
      onUpdate?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update unlimited vision status'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResetQuota() {
    if (!confirm('Reset this user\'s vision quota to 0 usage?')) return;
    try {
      setError(null);
      setActionLoading(true);
      await resetUserVisionQuota(userId);
      await refreshUserAndQuota();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to reset quota'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSetQuota() {
    const scansUsed = parseInt(quotaScansInput, 10);
    if (isNaN(scansUsed) || scansUsed < 0) {
      setError('Scans used must be a non-negative number');
      return;
    }

    const quotaUpdate = { scansUsed };

    if (quotaTokensInput.trim() !== '') {
      const tokensUsed = parseInt(quotaTokensInput, 10);
      if (isNaN(tokensUsed) || tokensUsed < 0) {
        setError('Tokens used must be a non-negative number');
        return;
      }
      quotaUpdate.tokensUsed = tokensUsed;
    }

    if (quotaOutputTokensInput.trim() !== '') {
      const outputTokensUsed = parseInt(quotaOutputTokensInput, 10);
      if (isNaN(outputTokensUsed) || outputTokensUsed < 0) {
        setError('Output tokens used must be a non-negative number');
        return;
      }
      quotaUpdate.outputTokensUsed = outputTokensUsed;
    }

    try {
      setError(null);
      setActionLoading(true);
      await setUserVisionQuota(userId, quotaUpdate);
      await refreshUserAndQuota();
      setShowQuotaForm(false);
      setQuotaScansInput('');
      setQuotaTokensInput('');
      setQuotaOutputTokensInput('');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to set quota'));
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">User Details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <div className="text-center py-8">Loading...</div>
          ) : error ? (
            <div className="text-center py-8 text-red-600">{error}</div>
          ) : user ? (
            <div className="space-y-6">
              {/* User Info */}
              <div className="flex items-center space-x-4">
                <UserAvatar user={user} size="16" textSize="text-xl" />
                <div>
                  <h4 className="text-xl font-semibold text-gray-900">
                    {user.username || 'No username'}
                  </h4>
                  <p className="text-gray-500">{user.email}</p>
                </div>
              </div>

              {/* Status Badges */}
              <UserBadge user={user} variant="md" />

              {/* Suspension Info */}
              {user.isSuspended && user.suspensionReason && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                  <h5 className="text-sm font-medium text-red-800">Suspension Reason</h5>
                  <p className="mt-1 text-sm text-red-700">{user.suspensionReason}</p>
                  {user.suspendedAt && (
                    <p className="mt-2 text-xs text-red-600">
                      Suspended on {new Date(user.suspendedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-semibold text-gray-900">{user.shelfCount || 0}</div>
                  <div className="text-sm text-gray-500">Shelves</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-semibold text-gray-900">{user.collectionCount || 0}</div>
                  <div className="text-sm text-gray-500">Items</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-semibold text-gray-900">{user.friendCount || 0}</div>
                  <div className="text-sm text-gray-500">Friends</div>
                </div>
              </div>

              {/* Premium & Vision */}
              <div className="border-t border-gray-200 pt-4">
                <h5 className="text-sm font-semibold text-gray-700 mb-3">Premium & Vision</h5>
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-700">Premium Status</span>
                      <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.isPremium ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                        {user.isPremium ? 'Premium' : 'Free'}
                      </span>
                      {user.premiumLockedByAdmin && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                          Locked by Admin
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleTogglePremium}
                      disabled={actionLoading}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md disabled:opacity-50 ${user.isPremium
                        ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        : 'bg-yellow-500 text-white hover:bg-yellow-600'
                      }`}
                    >
                      {user.isPremium ? 'Remove Premium' : 'Grant Premium'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-700">Unlimited Vision</span>
                      <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.unlimitedVisionTokens ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {user.unlimitedVisionTokens ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <button
                      onClick={handleToggleUnlimitedVision}
                      disabled={actionLoading}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md disabled:opacity-50 ${user.unlimitedVisionTokens
                        ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {user.unlimitedVisionTokens ? 'Remove Unlimited' : 'Grant Unlimited'}
                    </button>
                  </div>

                  {quota && (
                    <>
                      <div className="border-t border-gray-200 pt-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">Vision Quota</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setShowQuotaForm(!showQuotaForm);
                                setQuotaScansInput(String(quota.scansUsed ?? 0));
                                setQuotaTokensInput(String(quota.tokensUsed ?? 0));
                                setQuotaOutputTokensInput(String(quota.outputTokensUsed ?? 0));
                              }}
                              disabled={actionLoading}
                              className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={handleResetQuota}
                              disabled={actionLoading}
                              className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div>
                            <div className="text-lg font-semibold text-gray-900">{(quota.tokensUsed ?? 0).toLocaleString()}</div>
                            <div className="text-xs text-gray-500">Tokens Used</div>
                          </div>
                          <div>
                            <div className="text-lg font-semibold text-gray-900">{Math.max(0, 100 - (quota.percentUsed ?? 0))}%</div>
                            <div className="text-xs text-gray-500">% Remaining</div>
                          </div>
                          <div>
                            <div className="text-lg font-semibold text-gray-900">{quota.daysRemaining}</div>
                            <div className="text-xs text-gray-500">Days Left</div>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-gray-500 text-center space-y-1">
                          <div>
                            Token limit: {(quota.tokenLimit ?? 0).toLocaleString()} &middot; Output tokens: {(quota.outputTokensUsed ?? 0).toLocaleString()} / {(quota.outputTokenLimit ?? 0).toLocaleString()}
                          </div>
                          <div>
                            Legacy scans: {quota.scansUsed} / {quota.monthlyLimit} &middot; Period started: {new Date(quota.periodStart).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      {showQuotaForm && (
                        <div className="border-t border-gray-200 pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                          <label className="text-sm text-gray-600">
                            <span className="block mb-1">Scans used</span>
                            <input
                              type="number"
                              min="0"
                              value={quotaScansInput}
                              onChange={(e) => setQuotaScansInput(e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                          </label>
                          <label className="text-sm text-gray-600">
                            <span className="block mb-1">Tokens used</span>
                            <input
                              type="number"
                              min="0"
                              value={quotaTokensInput}
                              onChange={(e) => setQuotaTokensInput(e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                          </label>
                          <label className="text-sm text-gray-600">
                            <span className="block mb-1">Output tokens used</span>
                            <input
                              type="number"
                              min="0"
                              value={quotaOutputTokensInput}
                              onChange={(e) => setQuotaOutputTokensInput(e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                          </label>
                          <div className="md:col-span-3 flex items-center gap-2">
                            <button
                              onClick={handleSetQuota}
                              disabled={actionLoading}
                              className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setShowQuotaForm(false)}
                              className="px-3 py-1 text-xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Details */}
              <div className="border-t border-gray-200 pt-4">
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Name</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Location</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {[user.city, user.state, user.country].filter(Boolean).join(', ') || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Joined</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Privacy</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {user.isPrivate ? 'Private' : 'Public'}
                    </dd>
                  </div>
                </dl>
                {user.bio && (
                  <div className="mt-4">
                    <dt className="text-sm font-medium text-gray-500 mb-1">Bio</dt>
                    <dd className="text-sm text-gray-900 whitespace-pre-wrap break-words bg-gray-50 rounded-md p-3 border border-gray-200">
                      {user.bio}
                    </dd>
                  </div>
                )}
              </div>

              {/* Suspend Form */}
              {showSuspendForm && (
                <div className="border-t border-gray-200 pt-4">
                  <label className="block text-sm font-medium text-gray-700">
                    Suspension Reason (optional)
                  </label>
                  <textarea
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                    placeholder="Enter reason for suspension..."
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={handleSuspend}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                    >
                      {actionLoading ? 'Suspending...' : 'Confirm Suspend'}
                    </button>
                    <button
                      onClick={() => { setShowSuspendForm(false); setSuspendReason(''); }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="border-t border-gray-200 pt-4 flex flex-wrap gap-3">
                {user.isSuspended ? (
                  <button
                    onClick={handleUnsuspend}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading ? 'Processing...' : 'Unsuspend User'}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowSuspendForm(true)}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    Suspend User
                  </button>
                )}
                <button
                  onClick={handleToggleAdmin}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Processing...' : user.isAdmin ? 'Remove Admin' : 'Make Admin'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
