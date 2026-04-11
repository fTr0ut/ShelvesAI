import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getModerationItems, applyModerationAction } from '../api/client';
import { getErrorMessage } from '../utils/errorUtils';

const STATUS_STYLES = {
  active: 'bg-gray-100 text-gray-700',
  flagged: 'bg-amber-100 text-amber-800',
  hidden: 'bg-orange-100 text-orange-800',
  cleared: 'bg-blue-100 text-blue-800',
  deleted: 'bg-red-100 text-red-800',
};

const CONTENT_TYPE_OPTIONS = [
  '',
  'profile_bio',
  'shelf',
  'shelf_item_note',
  'event_note',
  'event_comment',
  'user_list',
  'user_list_item',
  'wishlist',
  'wishlist_item',
  'profile_media',
  'owner_photo',
];

function formatContentType(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function timeLabel(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export default function Moderation() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [contentType, setContentType] = useState('');
  const [cursor, setCursor] = useState(null);
  const [cursorHistory, setCursorHistory] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [botMode, setBotMode] = useState('recommend_only');
  const [alertHumanAdmins, setAlertHumanAdmins] = useState(true);
  const [actionState, setActionState] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getModerationItems({
        limit: 25,
        cursor: cursor || undefined,
        search: search || undefined,
        status: status || undefined,
        contentType: contentType || undefined,
      });
      setItems(response.data.items || []);
      setNextCursor(response.data.pagination?.nextCursor || null);
      setBotMode(response.data.botMode || 'recommend_only');
      setAlertHumanAdmins(response.data.alertHumanAdmins !== false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load moderation items'));
    } finally {
      setLoading(false);
    }
  }, [contentType, cursor, search, status]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    const nextContentType = searchParams.get('contentType');
    if (nextContentType && CONTENT_TYPE_OPTIONS.includes(nextContentType)) {
      setContentType(nextContentType);
      setSearchInput(searchParams.get('contentId') || '');
      setSearch(searchParams.get('contentId') || '');
      resetPaging();
    }
  }, [searchParams]);

  function resetPaging() {
    setCursor(null);
    setCursorHistory([]);
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    setSearch(searchInput.trim());
    resetPaging();
  }

  async function handleActionSubmit(event) {
    event.preventDefault();
    if (!actionState?.item || !actionState?.action) return;
    if (!actionState.reason.trim()) {
      setError('A moderation reason is required');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await applyModerationAction({
        contentType: actionState.item.contentType,
        contentId: actionState.item.contentId,
        action: actionState.action,
        reason: actionState.reason.trim(),
        ruleCode: actionState.ruleCode.trim() || undefined,
        confidence: actionState.confidence === '' ? undefined : Number(actionState.confidence),
        actorType: actionState.actorType,
        execute: actionState.execute,
        suspendReason: actionState.suspendReason.trim() || undefined,
      });
      setActionState(null);
      await loadItems();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to apply moderation action'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Moderation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Dedicated review surface for all user-generated content.
          </p>
        </div>
        <div className="mt-3 sm:mt-0 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            Bot mode: {botMode}
          </span>
          {alertHumanAdmins && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
              Human alerts enabled
            </span>
          )}
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search text, author, type, or route..."
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 md:col-span-2"
          />
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              resetPaging();
            }}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="flagged">Flagged</option>
            <option value="hidden">Hidden</option>
            <option value="cleared">Cleared</option>
            <option value="deleted">Deleted</option>
          </select>
          <select
            value={contentType}
            onChange={(event) => {
              setContentType(event.target.value);
              resetPaging();
            }}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          >
            {CONTENT_TYPE_OPTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option ? formatContentType(option) : 'All content types'}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 md:col-start-4"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {loading && !items.length ? (
          <div className="bg-white shadow rounded-lg text-center py-12 text-gray-500">
            Loading moderation queue...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white shadow rounded-lg text-center py-12 text-gray-500">
            No moderation items found
          </div>
        ) : (
          items.map((item) => (
            <div key={`${item.contentType}:${item.contentId}`} className="bg-white shadow rounded-lg p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      {formatContentType(item.contentType)}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status] || STATUS_STYLES.active}`}>
                      {item.status}
                    </span>
                    <span className="text-xs text-gray-400">Updated {timeLabel(item.updatedAt)}</span>
                  </div>
                  <h2 className="text-lg font-medium text-gray-900 break-words">
                    {item.title || `${formatContentType(item.contentType)} ${item.contentId}`}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Author: <span className="font-medium text-gray-700">{item.authorUsername || 'Unknown'}</span>
                    {item.visibility && <span className="ml-3">Visibility: {item.visibility}</span>}
                  </p>
                  {item.text && (
                    <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 font-sans">
                      {item.text}
                    </pre>
                  )}
                  {item.mediaRefs?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.mediaRefs.map((media, index) => (
                        <a
                          key={`${media.url || media.path || index}`}
                          href={media.url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {media.label || media.kind}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>ID: {item.contentId}</span>
                    {item.sourceRoute && (
                      <Link to={item.sourceRoute} className="text-blue-600 hover:text-blue-800">
                        Open source
                      </Link>
                    )}
                  </div>
                  {item.priorModerationActions?.length > 0 && (
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        Prior moderation
                      </h3>
                      <div className="space-y-2">
                        {item.priorModerationActions.map((entry) => (
                          <div key={entry.id} className="text-xs text-gray-600">
                            <span className="font-medium text-gray-800">{entry.action}</span>
                            <span className="ml-2">{timeLabel(entry.createdAt)}</span>
                            {entry.ruleCode && <span className="ml-2">Rule: {entry.ruleCode}</span>}
                            {entry.reason && <span className="ml-2">Reason: {entry.reason}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 lg:w-64 lg:justify-end">
                  {item.availableActions?.map((action) => (
                    <button
                      key={action}
                      onClick={() => setActionState({
                        item,
                        action,
                        reason: '',
                        ruleCode: '',
                        confidence: '',
                        actorType: 'human',
                        execute: false,
                        suspendReason: '',
                      })}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                      {action.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => {
            if (!cursorHistory.length) return;
            const nextHistory = [...cursorHistory];
            const previousCursor = nextHistory.pop() || null;
            setCursorHistory(nextHistory);
            setCursor(previousCursor);
          }}
          disabled={!cursorHistory.length}
          className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => {
            if (!nextCursor) return;
            setCursorHistory((prev) => [...prev, cursor]);
            setCursor(nextCursor);
          }}
          disabled={!nextCursor}
          className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {actionState && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full mx-4">
            <form onSubmit={handleActionSubmit}>
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">
                    {actionState.action.replace(/_/g, ' ')} {actionState.item.title || actionState.item.contentId}
                  </h3>
                  <p className="text-sm text-gray-500">{formatContentType(actionState.item.contentType)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActionState(null)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  ×
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                  <textarea
                    value={actionState.reason}
                    onChange={(event) => setActionState((prev) => ({ ...prev, reason: event.target.value }))}
                    rows={4}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                    placeholder="Explain the moderation decision..."
                    required
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="text-sm text-gray-700">
                    <span className="block mb-1 font-medium">Rule code</span>
                    <input
                      type="text"
                      value={actionState.ruleCode}
                      onChange={(event) => setActionState((prev) => ({ ...prev, ruleCode: event.target.value }))}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                      placeholder="policy.rule"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="block mb-1 font-medium">Confidence</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={actionState.confidence}
                      onChange={(event) => setActionState((prev) => ({ ...prev, confidence: event.target.value }))}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                      placeholder="0.95"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="block mb-1 font-medium">Actor type</span>
                    <select
                      value={actionState.actorType}
                      onChange={(event) => setActionState((prev) => ({ ...prev, actorType: event.target.value }))}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                    >
                      <option value="human">human</option>
                      <option value="bot">bot</option>
                    </select>
                  </label>
                </div>
                {actionState.action === 'suspend_user' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Suspension reason</label>
                    <textarea
                      value={actionState.suspendReason}
                      onChange={(event) => setActionState((prev) => ({ ...prev, suspendReason: event.target.value }))}
                      rows={3}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                      placeholder="Optional suspension note shown to admins"
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={actionState.execute}
                    onChange={(event) => setActionState((prev) => ({ ...prev, execute: event.target.checked }))}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Execute action now
                </label>
                {actionState.actorType === 'bot' && actionState.execute && botMode === 'recommend_only' && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    Bot execution is currently disabled by `moderation_bot_config`.
                  </p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActionState(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : actionState.execute ? 'Execute Action' : 'Record Recommendation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
