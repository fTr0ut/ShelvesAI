import { useState, useEffect, useCallback } from 'react';
import { getRecentFeed } from '../api/client';
import UserAvatar from '../components/UserAvatar';
import Pagination from '../components/Pagination';

const EVENT_TYPE_COLORS = {
  'item.added': 'bg-green-100 text-green-800',
  'item.removed': 'bg-red-100 text-red-800',
  'item.updated': 'bg-blue-100 text-blue-800',
  'shelf.created': 'bg-purple-100 text-purple-800',
  'shelf.updated': 'bg-indigo-100 text-indigo-800',
  'shelf.deleted': 'bg-red-100 text-red-800',
  'checkin.started': 'bg-yellow-100 text-yellow-800',
  'checkin.completed': 'bg-green-100 text-green-800',
  'rating.added': 'bg-orange-100 text-orange-800',
  'rating.updated': 'bg-orange-100 text-orange-800',
};

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

export default function ActivityFeed() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [error, setError] = useState(null);
  const limit = 50;

  const loadActivity = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getRecentFeed({ limit, offset: page * limit });
      setActivity(response.data.activity);
    } catch (err) {
      setError('Failed to load activity feed');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Activity Feed</h1>
        <button
          onClick={loadActivity}
          className="mt-3 sm:mt-0 px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading activity...</div>
        ) : activity.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No activity found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shelf</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {activity.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <UserAvatar user={{ username: item.username, picture: item.userPicture }} size="8" />
                          <span className="ml-3 text-sm font-medium text-gray-900">
                            {item.username || 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventColor(item.eventType)}`}>
                          {item.eventType}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {item.shelfName ? (
                          <span>
                            {item.shelfName}
                            {item.shelfType && (
                              <span className="ml-1 text-xs text-gray-400">({item.shelfType})</span>
                            )}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {item.itemCount || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" title={item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleString() : ''}>
                        {item.lastActivityAt ? timeAgo(item.lastActivityAt) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {activity.length >= limit && (
              <Pagination
                page={page}
                totalPages={page + 2}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
