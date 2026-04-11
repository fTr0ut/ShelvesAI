import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getStats, getSystemInfo, getDetailedStats, getRecentFeed } from '../api/client';
import StatsCard from '../components/StatsCard';
import UserAvatar from '../components/UserAvatar';
import { getErrorMessage } from '../utils/errorUtils';

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function BarChart({ data, labelKey, valueKey, color = 'bg-blue-500', maxItems = 10 }) {
  if (!data || data.length === 0) return <div className="text-sm text-gray-400">No data</div>;
  const items = data.slice(0, maxItems);
  const maxValue = Math.max(...items.map(d => d[valueKey]), 1);

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-24 text-xs text-gray-600 text-right truncate" title={String(item[labelKey])}>
            {String(item[labelKey])}
          </div>
          <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
            <div
              className={`h-full ${color} rounded-full transition-all duration-500`}
              style={{ width: `${Math.max((item[valueKey] / maxValue) * 100, 2)}%` }}
            />
          </div>
          <div className="w-12 text-xs text-gray-700 text-right font-medium">
            {item[valueKey]?.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [detailed, setDetailed] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [statsRes, systemRes, detailedRes, feedRes] = await Promise.all([
        getStats(),
        getSystemInfo(),
        getDetailedStats().catch(() => ({ data: null })),
        getRecentFeed({ limit: 5 }).catch(() => ({ data: { activity: [] } })),
      ]);
      setStats(statsRes.data);
      setSystemInfo(systemRes.data);
      setDetailed(detailedRes.data);
      setRecentActivity(feedRes.data.activity || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load dashboard data'));
    } finally {
      setLoading(false);
    }
  }

  function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(' ') || '< 1m';
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600">{error}</div>
        <button onClick={loadData} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          Retry
        </button>
      </div>
    );
  }

  const userGrowth = (detailed?.usersByMonth || []).map(d => ({
    label: new Date(d.month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    count: d.count,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatsCard
          title="Total Users"
          value={stats?.totalUsers?.toLocaleString() || 0}
          subtitle={`+${stats?.newUsersLast7Days || 0} this week`}
          color="blue"
          to="/users"
        />
        <StatsCard
          title="Total Shelves"
          value={stats?.totalShelves?.toLocaleString() || 0}
          color="green"
          to="/content"
        />
        <StatsCard
          title="Total Items"
          value={stats?.totalCollections?.toLocaleString() || 0}
          color="purple"
        />
        <StatsCard
          title="Premium Users"
          value={detailed?.premiumUsers?.toLocaleString() || 0}
          color="yellow"
          to="/users?premium=true"
        />
        <StatsCard
          title="Admin Users"
          value={stats?.adminUsers || 0}
          color="indigo"
          to="/users?admin=true"
        />
        <StatsCard
          title="Suspended Users"
          value={stats?.suspendedUsers || 0}
          color="red"
          to="/users?suspended=true"
        />
        <StatsCard
          title="Vision Scans"
          value={detailed?.visionUsage?.totalScans?.toLocaleString() || 0}
          subtitle={`${detailed?.visionUsage?.activeUsers || 0} users`}
          color="blue"
          to="/jobs?jobType=request"
        />
        <StatsCard
          title="New Users (7d)"
          value={stats?.newUsersLast7Days || 0}
          color="green"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* User Growth */}
        {userGrowth.length > 0 && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">User Growth (12 Months)</h2>
            <BarChart data={userGrowth} labelKey="label" valueKey="count" color="bg-blue-500" />
          </div>
        )}

        {/* Shelf Distribution */}
        {detailed?.shelvesByType?.length > 0 && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Shelf Distribution</h2>
            <BarChart data={detailed.shelvesByType} labelKey="type" valueKey="count" color="bg-green-500" />
          </div>
        )}

        {/* Collectables by Kind */}
        {detailed?.collectablesByKind?.length > 0 && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Catalog by Kind</h2>
            <BarChart data={detailed.collectablesByKind} labelKey="kind" valueKey="count" color="bg-purple-500" />
          </div>
        )}

        {/* Recent Activity */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-gray-900">Recent Activity</h2>
            <Link to="/activity" className="text-sm text-blue-600 hover:text-blue-800">
              View all &rarr;
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="text-sm text-gray-400">No recent activity</div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-1">
                  <UserAvatar user={{ username: item.username, picture: item.userPicture }} size="8" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900">{item.username}</span>
                    <span className="text-sm text-gray-500 ml-2">{item.eventType}</span>
                    {item.shelfName && (
                      <span className="text-sm text-gray-400 ml-1">on {item.shelfName}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {item.lastActivityAt ? timeAgo(item.lastActivityAt) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* System Info */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">System Status</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm font-medium text-gray-500">Uptime</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.uptime ? formatUptime(systemInfo.uptime) : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Memory (Heap)</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.memory?.heapUsed || 0} / {systemInfo?.memory?.heapTotal || 0} MB
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Node Version</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.nodeVersion || '-'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Platform</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.platform || '-'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Moderation Mode</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.moderation?.botMode || 'recommend_only'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Flagged Items</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.moderation?.counts?.flagged ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Bot Actions (24h)</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.moderation?.recentBotActions24h ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Last Alert</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {systemInfo?.moderation?.lastAlertSentAt ? new Date(systemInfo.moderation.lastAlertSentAt).toLocaleString() : '-'}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
