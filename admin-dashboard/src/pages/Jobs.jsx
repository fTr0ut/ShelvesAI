import { useState, useEffect, useCallback } from 'react';
import { getJobs } from '../api/client';
import Pagination from '../components/Pagination';
import JobDetailModal from '../components/JobDetailModal';

const STATUS_BADGE = {
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchJobId, setSearchJobId] = useState('');
  const [selectedJobId, setSelectedJobId] = useState(null);
  const limit = 50;

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        limit,
        offset: page * limit,
        status: statusFilter || undefined,
        jobType: typeFilter || undefined,
        jobId: searchJobId.trim() || undefined,
      };
      const response = await getJobs(params);
      setJobs(response.data.jobs);
      setPagination(response.data.pagination);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, searchJobId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Job Monitoring</h1>
        <div className="mt-3 sm:mt-0 flex items-center gap-3">
          <span className="text-sm text-gray-500">{pagination.total} jobs</span>
          <button
            onClick={loadJobs}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          >
            <option value="">All Status</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          >
            <option value="">All Types</option>
            <option value="request">Request</option>
            <option value="scheduled">Scheduled</option>
            <option value="script">Script</option>
            <option value="manual">Manual</option>
            <option value="system">System</option>
          </select>
          <input
            type="text"
            value={searchJobId}
            onChange={(e) => setSearchJobId(e.target.value)}
            placeholder="Search by Job ID..."
            className="flex-1 min-w-[200px] rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          />
        </div>
      </div>

      {/* Jobs Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No jobs found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">HTTP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {jobs.map((job) => (
                    <tr
                      key={job.jobId}
                      onClick={() => setSelectedJobId(job.jobId)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-mono text-gray-900" title={job.jobId}>
                          {job.jobId?.length > 20 ? `${job.jobId.slice(0, 20)}...` : job.jobId}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm text-gray-700">{job.jobType}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[job.status] || 'bg-gray-100 text-gray-800'}`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 font-mono">
                        {job.httpMethod ? (
                          <>
                            {job.httpMethod} {job.httpPath?.length > 30 ? `${job.httpPath.slice(0, 30)}...` : job.httpPath}
                            {job.httpStatus && (
                              <span className={`ml-1 ${job.httpStatus >= 400 ? 'text-red-600' : 'text-green-600'}`}>
                                ({job.httpStatus})
                              </span>
                            )}
                          </>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {job.durationMs != null ? `${job.durationMs}ms` : '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {job.startedAt ? new Date(job.startedAt).toLocaleString() : '-'}
                      </td>
                    </tr>
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

      {selectedJobId && (
        <JobDetailModal
          jobId={selectedJobId}
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </div>
  );
}
