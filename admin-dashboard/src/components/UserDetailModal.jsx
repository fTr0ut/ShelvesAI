import { useState, useEffect } from 'react';
import { getUser, suspendUser, unsuspendUser, toggleAdmin } from '../api/client';

export default function UserDetailModal({ userId, onClose, onUpdate }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (userId) {
      loadUser();
    }
  }, [userId]);

  async function loadUser() {
    try {
      setLoading(true);
      setError(null);
      const response = await getUser(userId);
      setUser(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }

  async function handleSuspend() {
    try {
      setActionLoading(true);
      await suspendUser(userId, suspendReason);
      await loadUser();
      setShowSuspendForm(false);
      setSuspendReason('');
      onUpdate?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to suspend user');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUnsuspend() {
    try {
      setActionLoading(true);
      await unsuspendUser(userId);
      await loadUser();
      onUpdate?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to unsuspend user');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleAdmin() {
    if (!confirm(`Are you sure you want to ${user?.isAdmin ? 'remove' : 'grant'} admin privileges?`)) {
      return;
    }
    try {
      setActionLoading(true);
      await toggleAdmin(userId);
      await loadUser();
      onUpdate?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update admin status');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">User Details</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
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
                {user.picture ? (
                  <img
                    className="h-16 w-16 rounded-full object-cover"
                    src={user.picture}
                    alt=""
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-gray-300 flex items-center justify-center">
                    <span className="text-gray-600 text-xl font-medium">
                      {user.username?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                )}
                <div>
                  <h4 className="text-xl font-semibold text-gray-900">
                    {user.username || 'No username'}
                  </h4>
                  <p className="text-gray-500">{user.email}</p>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex gap-2">
                {user.isSuspended ? (
                  <span className="px-3 py-1 text-sm font-semibold rounded-full bg-red-100 text-red-800">
                    Suspended
                  </span>
                ) : (
                  <span className="px-3 py-1 text-sm font-semibold rounded-full bg-green-100 text-green-800">
                    Active
                  </span>
                )}
                {user.isAdmin && (
                  <span className="px-3 py-1 text-sm font-semibold rounded-full bg-purple-100 text-purple-800">
                    Admin
                  </span>
                )}
                {user.isPremium && (
                  <span className="px-3 py-1 text-sm font-semibold rounded-full bg-yellow-100 text-yellow-800">
                    Premium
                  </span>
                )}
              </div>

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
                      onClick={() => {
                        setShowSuspendForm(false);
                        setSuspendReason('');
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="border-t border-gray-200 pt-4 flex gap-3">
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
