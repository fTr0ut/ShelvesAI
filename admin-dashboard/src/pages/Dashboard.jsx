import { useState, useEffect } from 'react';
import { getStats, getSystemInfo } from '../api/client';
import StatsCard from '../components/StatsCard';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [statsResponse, systemResponse] = await Promise.all([
        getStats(),
        getSystemInfo(),
      ]);
      setStats(statsResponse.data);
      setSystemInfo(systemResponse.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load dashboard data');
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
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        <StatsCard
          title="Total Users"
          value={stats?.totalUsers?.toLocaleString() || 0}
          subtitle={`+${stats?.newUsersLast7Days || 0} this week`}
          color="blue"
        />
        <StatsCard
          title="Total Shelves"
          value={stats?.totalShelves?.toLocaleString() || 0}
          color="green"
        />
        <StatsCard
          title="Total Items"
          value={stats?.totalCollections?.toLocaleString() || 0}
          color="purple"
        />
        <StatsCard
          title="Admin Users"
          value={stats?.adminUsers || 0}
          color="indigo"
        />
        <StatsCard
          title="Suspended Users"
          value={stats?.suspendedUsers || 0}
          color="red"
        />
        <StatsCard
          title="New Users (7d)"
          value={stats?.newUsersLast7Days || 0}
          color="yellow"
        />
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
        </dl>
      </div>
    </div>
  );
}
