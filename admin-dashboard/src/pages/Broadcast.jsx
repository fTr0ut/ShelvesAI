import { useState, useEffect, useCallback } from 'react';
import { sendBroadcast, getBroadcasts, cancelBroadcast, suppressBroadcast } from '../api/client';
import { getErrorMessage } from '../utils/errorUtils';

const TITLE_MAX = 100;
const BODY_MAX = 500;

const STATUS_LABELS = {
  pending: { text: 'Pending', classes: 'bg-gray-100 text-gray-700' },
  running: { text: 'Running', classes: 'bg-yellow-100 text-yellow-800' },
  completed: { text: 'Sent', classes: 'bg-green-100 text-green-700' },
  cancelled: { text: 'Cancelled', classes: 'bg-orange-100 text-orange-700' },
};

function StatusBadge({ status, isSuppressed }) {
  const cfg = STATUS_LABELS[status] || { text: status, classes: 'bg-gray-100 text-gray-700' };
  return (
    <span className="inline-flex gap-1 items-center">
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cfg.classes}`}>
        {cfg.text}
      </span>
      {isSuppressed && (
        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
          Recalled
        </span>
      )}
    </span>
  );
}

export default function Broadcast() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendResult, setSendResult] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const res = await getBroadcasts();
      setHistory(res.data.broadcasts);
    } catch (err) {
      setHistoryError(getErrorMessage(err, 'Failed to load broadcast history'));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function handleSend(e) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    try {
      setSending(true);
      setSendError(null);
      setSendResult(null);
      const res = await sendBroadcast({ title: title.trim(), body: body.trim() });
      setSendResult(res.data);
      setTitle('');
      setBody('');
      await loadHistory();
    } catch (err) {
      setSendError(getErrorMessage(err, 'Failed to send broadcast'));
    } finally {
      setSending(false);
    }
  }

  async function handleCancel(id) {
    setActionError(null);
    try {
      await cancelBroadcast(id);
      await loadHistory();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Failed to cancel broadcast'));
    }
  }

  async function handleSuppress(id) {
    setActionError(null);
    try {
      await suppressBroadcast(id);
      await loadHistory();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Failed to recall broadcast'));
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Broadcast Message</h1>

      {/* Compose form */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Send to All Users</h3>
          <p className="mt-1 text-sm text-gray-500">
            Sends a push notification to every active device. Bypasses individual notification preferences.
          </p>

          {sendError && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{sendError}</p>
            </div>
          )}

          {sendResult && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-700">
                Broadcast sent — {sendResult.totalTokens} device{sendResult.totalTokens !== 1 ? 's' : ''} reached,{' '}
                {sendResult.successCount} succeeded, {sendResult.errorCount} failed.
              </p>
            </div>
          )}

          <form onSubmit={handleSend} className="mt-5 space-y-4">
            <div>
              <div className="flex justify-between">
                <label className="block text-sm font-medium text-gray-700">Title</label>
                <span className="text-xs text-gray-400">{title.length}/{TITLE_MAX}</span>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                maxLength={TITLE_MAX}
                placeholder="Announcement title"
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <div className="flex justify-between">
                <label className="block text-sm font-medium text-gray-700">Body</label>
                <span className="text-xs text-gray-400">{body.length}/{BODY_MAX}</span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                maxLength={BODY_MAX}
                rows={4}
                placeholder="Message body shown in the notification and in-app modal"
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={sending || !title.trim() || !body.trim()}
                className="px-5 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send Broadcast'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* History */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Broadcast History</h3>

          {actionError && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{actionError}</p>
            </div>
          )}

          {historyError && (
            <p className="mt-2 text-sm text-red-600">{historyError}</p>
          )}

          {historyLoading ? (
            <p className="mt-4 text-sm text-gray-500">Loading…</p>
          ) : history.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No broadcasts sent yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sent</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Body</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tokens</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">OK / Err</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {history.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(b.sentAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-gray-900 max-w-[160px] truncate">{b.title}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[220px] truncate">{b.body}</td>
                      <td className="px-4 py-3 text-gray-900">{b.totalTokens}</td>
                      <td className="px-4 py-3">
                        <span className="text-green-700">{b.successCount}</span>
                        {' / '}
                        <span className="text-red-600">{b.errorCount}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={b.status} isSuppressed={b.isSuppressed} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap space-x-2">
                        {(b.status === 'pending' || b.status === 'running') && (
                          <button
                            onClick={() => handleCancel(b.id)}
                            className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200"
                          >
                            Cancel
                          </button>
                        )}
                        {b.status === 'completed' && !b.isSuppressed && (
                          <button
                            onClick={() => handleSuppress(b.id)}
                            className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                          >
                            Recall
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
    </div>
  );
}
