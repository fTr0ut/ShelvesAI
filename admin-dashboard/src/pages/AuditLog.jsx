import { useState, useEffect, useCallback } from 'react';
import { getAuditLogs } from '../api/client';
import Pagination from '../components/Pagination';

const ACTION_COLORS = {
  USER_SUSPENDED: 'bg-red-100 text-red-800',
  USER_UNSUSPENDED: 'bg-green-100 text-green-800',
  ADMIN_GRANTED: 'bg-purple-100 text-purple-800',
  ADMIN_REVOKED: 'bg-purple-100 text-purple-800',
  PREMIUM_TOGGLED: 'bg-yellow-100 text-yellow-800',
  VISION_QUOTA_RESET: 'bg-orange-100 text-orange-800',
  VISION_QUOTA_SET: 'bg-orange-100 text-orange-800',
  update_setting: 'bg-blue-100 text-blue-800',
};

function getActionColor(action) {
  return ACTION_COLORS[action] || 'bg-gray-100 text-gray-800';
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const limit = 50;

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        limit,
        offset: page * limit,
        action: actionFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      const response = await getAuditLogs(params);
      setLogs(response.data.logs);
      setPagination(response.data.pagination);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, startDate, endDate]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const actionOptions = [
    'USER_SUSPENDED', 'USER_UNSUSPENDED',
    'ADMIN_GRANTED', 'ADMIN_REVOKED',
    'PREMIUM_TOGGLED',
    'VISION_QUOTA_RESET', 'VISION_QUOTA_SET',
    'update_setting',
  ];

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Audit Log</h1>
        <span className="mt-3 sm:mt-0 text-sm text-gray-500">{pagination.total} entries</span>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          >
            <option value="">All Actions</option>
            {actionOptions.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">From:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">To:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            />
          </div>
          {(actionFilter || startDate || endDate) && (
            <button
              onClick={() => { setActionFilter(''); setStartDate(''); setEndDate(''); setPage(0); }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading audit logs...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No audit logs found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log) => (
                    <>
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                          {log.adminUsername || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {log.targetUsername || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 font-mono">
                          {log.ipAddress || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <button
                              onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                              className="text-xs text-blue-600 hover:text-blue-800"
                            >
                              {expandedId === log.id ? 'Hide' : 'Show'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedId === log.id && log.metadata && (
                        <tr key={`${log.id}-meta`}>
                          <td colSpan={6} className="px-4 py-3 bg-gray-50">
                            <pre className="text-xs font-mono text-gray-700 overflow-x-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={Math.ceil(pagination.total / limit)}
              onPageChange={setPage}
              total={pagination.total}
              pageSize={limit}
            />
          </>
        )}
      </div>
    </div>
  );
}
