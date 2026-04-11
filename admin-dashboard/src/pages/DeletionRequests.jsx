import { useState, useEffect, useCallback } from 'react';
import { getDeletionRequests, approveDeletionRequest, rejectDeletionRequest } from '../api/client';

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

const STATUS_BADGE = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-greenreen-800',
  rejected: 'bg-red-100 text-red-800',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function truncate(text, max = 120) {
  if (!text) return '—';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function ActionModal({ request, action, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    await onConfirm(note.trim() || null);
    setLoading(false);
  }

  const isApprove = action === 'approve';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          {isApprove ? 'Approve Deletion Request' : 'Reject Deletion Request'}
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          User: <span className="font-medium">{request.username}</span> ({request.email})
        </p>

        {isApprove && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4 text-sm text-yellow-800">
            Approving this request will mark it for processing. Ensure the account is
            manually deleted or queued for deletion after approval.
          </div>
        )}

        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reviewer note (optional)
        </label>
        <textarea
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Add a note for the audit log..."
        />
        <div className="text-right text-xs text-gray-400 mb-4">{note.length}/500</div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
              isApprove
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
            } disabled:opacity-50`}
          >
            {loading ? 'Saving…' : isApprove ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeletionRequests() {
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState(null); // { request, action }
  const [toast, setToast] = useState(null);

  const limit = 20;

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDeletionRequests({
        status: statusFilter || undefined,
        page,
        limit,
      });
      setRequests(res.data.requests);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load deletion requests:', err);
      setError('Failed to load deletion requests.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  function showToast(message, isError = false) {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleConfirmAction(note) {
    const { request, action } = modal;
    try {
      if (action === 'approve') {
        await approveDeletionRequest(request.id, note || '');
      } else {
        await rejectDeletionRequest(request.id, note || '');
      }
      setModal(null);
      showToast(`Request ${action === 'approve' ? 'approved' : 'rejected'} successfully.`);
      // Optimistic update: remove from pending list, or reload
      if (statusFilter === 'pending') {
        setRequests((prev) => prev.filter((r) => r.id !== request.id));
        setTotal((prev) => Math.max(0, prev - 1));
      } else {
        await loadRequests();
      }
    } catch (err) {
      setModal(null);
      showToast(
        err?.response?.data?.error || `Failed to ${action} request.`,
        true
      );
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm font-medium text-white transition-all ${
            toast.isError ? 'bg-red-600' : 'bg-green-600'
          }`}
        >
          {toast.message}
        </div>
      )}

      {modal && (
        <ActionModal
          request={modal.request}
          action={modal.action}
          onClose={() => setModal(null)}
          onConfirm={handleConfirmAction}
        />
      )}

      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deletion Requests</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and action user account deletion requests.
          </p>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-6">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(0); }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                statusFilter === f.value
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
            Loading…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16 text-red-600 text-sm">
            {error}
          </div>
        ) : requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
            No deletion requests found.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reason
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Submitted
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reviewed by
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{r.username}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-xs">
                    {truncate(r.reason)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        STATUS_BADGE[r.status] || 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {r.reviewedByUsername || '—'}
                    {r.reviewerNote && (
                      <div className="text-xs text-gray-400 mt-0.5">{truncate(r.reviewerNote, 60)}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {r.status === 'pending' ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setModal({ request: r, action: 'approve' })}
                          className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setModal({ request: r, action: 'reject' })}
                          className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {formatDate(r.processedAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
