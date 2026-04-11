import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getAdminSocialFeed, getAdminEventComments, deleteEvent } from '../api/client';
import UserAvatar from '../components/UserAvatar';
import Pagination from '../components/Pagination';
import { getErrorMessage } from '../utils/errorUtils';

const EVENT_TYPE_COLORS = {
  'item.added': 'bg-green-100 text-green-800',
  'item.removed': 'bg-red-100 text-red-800',
  'item.updated': 'bg-blue-100 text-blue-800',
  'item.rated': 'bg-orange-100 text-orange-800',
  'shelf.created': 'bg-purple-100 text-purple-800',
  'shelf.updated': 'bg-indigo-100 text-indigo-800',
  'shelf.deleted': 'bg-red-100 text-red-800',
  'checkin.activity': 'bg-yellow-100 text-yellow-800',
  'checkin.started': 'bg-yellow-100 text-yellow-800',
  'checkin.completed': 'bg-green-100 text-green-800',
  'rating.added': 'bg-orange-100 text-orange-800',
  'rating.updated': 'bg-orange-100 text-orange-800',
};

const EVENT_TYPE_OPTIONS = [
  'item.added',
  'item.rated',
  'checkin.activity',
  'shelf.created',
  'shelf.updated',
  'shelf.deleted',
];

function getEventColor(eventType) {
  return EVENT_TYPE_COLORS[eventType] || 'bg-gray-100 text-gray-800';
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function EventDescription({ event }) {
  const isCheckin = event.eventType === 'checkin.activity';

  if (isCheckin) {
    const title = event.collectableTitle || event.manualName;
    const creator = event.collectableCreator || event.manualAuthor;
    return (
      <div className="text-sm text-gray-700">
        <span className="font-medium">{title || 'Unknown item'}</span>
        {creator && <span className="text-gray-500"> by {creator}</span>}
        {event.note && <p className="text-gray-500 mt-1 italic">"{event.note}"</p>}
        {event.checkinStatus && (
          <span className="ml-2 text-xs text-gray-400">({event.checkinStatus})</span>
        )}
      </div>
    );
  }

  if (event.shelfName) {
    return (
      <div className="text-sm text-gray-700">
        <span className="font-medium">{event.shelfName}</span>
        {event.shelfType && (
          <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
            {event.shelfType}
          </span>
        )}
        {event.itemCount > 0 && (
          <span className="text-gray-500 ml-2">{event.itemCount} item{event.itemCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    );
  }

  if (event.eventType === 'item.rated') {
    const title = event.collectableTitle || event.manualName;
    return (
      <div className="text-sm text-gray-700">
        Rated <span className="font-medium">{title || 'an item'}</span>
      </div>
    );
  }

  return null;
}

function CommentsList({ comments, loading, commentCount, onLoadMore }) {
  if (loading) {
    return <div className="text-sm text-gray-500 py-2 pl-12">Loading comments...</div>;
  }

  if (!comments.length) {
    return <div className="text-sm text-gray-400 py-2 pl-12">No comments</div>;
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2 pl-12">
      {comments.map((comment) => (
        <div key={comment.id} className="flex items-start space-x-2">
          <UserAvatar user={{ username: comment.username, picture: comment.picture }} size="6" />
          <div>
            <span className="text-sm font-medium text-gray-900">{comment.username}</span>
            <span className="text-xs text-gray-400 ml-2">{timeAgo(comment.createdAt)}</span>
            <p className="text-sm text-gray-700">{comment.content}</p>
          </div>
        </div>
      ))}
      {comments.length < commentCount && (
        <button
          onClick={onLoadMore}
          className="text-sm text-blue-600 hover:text-blue-800 pl-8"
        >
          Load more comments ({commentCount - comments.length} remaining)
        </button>
      )}
    </div>
  );
}

export default function SocialFeed() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [comments, setComments] = useState({});
  const [commentsLoading, setCommentsLoading] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const loadCounterRef = useRef(0);

  const limit = 30;

  const loadFeed = useCallback(async () => {
    const currentLoad = ++loadCounterRef.current;
    try {
      setLoading(true);
      setError(null);
      const params = { limit, offset: page * limit };
      if (eventTypeFilter) params.eventType = eventTypeFilter;
      const response = await getAdminSocialFeed(params);
      if (currentLoad !== loadCounterRef.current) return;
      setEvents(response.data.events);
      setTotal(response.data.pagination.total);
    } catch (err) {
      if (currentLoad !== loadCounterRef.current) return;
      setError('Failed to load social feed');
      console.error(err);
    } finally {
      if (currentLoad === loadCounterRef.current) {
        setLoading(false);
      }
    }
  }, [page, eventTypeFilter]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadFeed, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadFeed]);

  const handleFilterChange = (e) => {
    setEventTypeFilter(e.target.value);
    setPage(0);
    setExpandedEventId(null);
  };

  const toggleExpand = async (eventId) => {
    if (expandedEventId === eventId) {
      setExpandedEventId(null);
      return;
    }
    setExpandedEventId(eventId);

    if (!comments[eventId]) {
      setCommentsLoading(eventId);
      try {
        const response = await getAdminEventComments(eventId, { limit: 20, offset: 0 });
        setComments((prev) => ({
          ...prev,
          [eventId]: {
            items: response.data.comments,
            commentCount: response.data.commentCount,
          },
        }));
      } catch (err) {
        console.error('Failed to load comments:', err);
      } finally {
        setCommentsLoading(null);
      }
    }
  };

  const handleLoadMoreComments = async (eventId) => {
    const existing = comments[eventId];
    if (!existing) return;

    setCommentsLoading(eventId);
    try {
      const response = await getAdminEventComments(eventId, {
        limit: 20,
        offset: existing.items.length,
      });
      setComments((prev) => ({
        ...prev,
        [eventId]: {
          items: [...prev[eventId].items, ...response.data.comments],
          commentCount: response.data.commentCount,
        },
      }));
    } catch (err) {
      console.error('Failed to load more comments:', err);
    } finally {
      setCommentsLoading(null);
    }
  };

  const handleDelete = async (eventId) => {
    if (!confirm('Are you sure you want to delete this event? This will permanently remove all likes and comments on it.')) {
      return;
    }
    setDeleteLoading(eventId);
    try {
      await deleteEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setTotal((prev) => Math.max(0, prev - 1));
      if (expandedEventId === eventId) setExpandedEventId(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete event'));
    } finally {
      setDeleteLoading(null);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Social Feed</h1>
        <div className="mt-3 sm:mt-0 flex items-center space-x-3">
          <select
            value={eventTypeFilter}
            onChange={handleFilterChange}
            className="block rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            {EVENT_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md border ${
              autoRefresh
                ? 'bg-green-50 border-green-300 text-green-700'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh'}
          </button>

          <button
            onClick={loadFeed}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading && !events.length ? (
        <div className="bg-white shadow rounded-lg text-center py-12 text-gray-500">Loading social feed...</div>
      ) : events.length === 0 ? (
        <div className="bg-white shadow rounded-lg text-center py-12 text-gray-500">No events found</div>
      ) : (
        <>
          <div className="space-y-4">
            {events.map((event) => (
              <div
                key={event.id}
                className="bg-white shadow rounded-lg p-4"
              >
                {/* Top row: user + event type + time + delete */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <UserAvatar user={{ username: event.username, picture: event.userPicture }} size="10" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900">
                          {event.username || 'Unknown'}
                        </span>
                        {event.userSuspended && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                            suspended
                          </span>
                        )}
                      </div>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventColor(event.eventType)}`}>
                        {event.eventType}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-gray-400" title={event.lastActivityAt ? new Date(event.lastActivityAt).toLocaleString() : ''}>
                      {event.lastActivityAt ? timeAgo(event.lastActivityAt) : '-'}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(event.id); }}
                      disabled={deleteLoading === event.id}
                      className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50"
                      title="Delete event"
                    >
                      {deleteLoading === event.id ? (
                        <span className="text-xs">...</span>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Middle: event description */}
                <div
                  className="mt-3 cursor-pointer"
                  onClick={() => toggleExpand(event.id)}
                >
                  <EventDescription event={event} />
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                  {event.userId && (
                    <Link
                      to={`/users?selectedUserId=${encodeURIComponent(String(event.userId))}`}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Open author
                    </Link>
                  )}
                  {event.shelfId && (
                    <Link
                      to={`/content?selectedShelfId=${encodeURIComponent(String(event.shelfId))}`}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Open parent content
                    </Link>
                  )}
                </div>

                {/* Bottom: social stats */}
                <div className="mt-3 flex items-center space-x-4 text-sm text-gray-500">
                  <span className="flex items-center space-x-1">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                    </svg>
                    <span>{event.likeCount}</span>
                  </span>
                  <button
                    onClick={() => toggleExpand(event.id)}
                    className="flex items-center space-x-1 hover:text-gray-700"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                    </svg>
                    <span>{event.commentCount}</span>
                  </button>
                  {event.visibility && event.visibility !== 'public' && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {event.visibility}
                    </span>
                  )}
                </div>

                {/* Expanded: comments */}
                {expandedEventId === event.id && (
                  <CommentsList
                    comments={comments[event.id]?.items || []}
                    loading={commentsLoading === event.id}
                    commentCount={comments[event.id]?.commentCount || event.commentCount}
                    onLoadMore={() => handleLoadMoreComments(event.id)}
                  />
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
