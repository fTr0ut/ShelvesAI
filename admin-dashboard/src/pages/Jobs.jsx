import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getJobs, getWorkfeed } from '../api/client';
import Pagination from '../components/Pagination';
import JobDetailModal from '../components/JobDetailModal';
import WorkfeedDetailModal from '../components/WorkfeedDetailModal';

const WORKFEED_STATUS_BADGE = {
  queued: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  aborted: 'bg-gray-100 text-gray-800',
};

const JOB_RUN_STATUS_BADGE = {
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const WORKFEED_POLL_MS = 5000;

function formatRelativeTime(dateValue) {
  if (!dateValue) return '-';
  const timestamp = new Date(dateValue).getTime();
  if (!Number.isFinite(timestamp)) return '-';
  const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSeconds < 5) return 'now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDateTime(dateValue) {
  if (!dateValue) return '-';
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function normalizeProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function buildWorkfeedProgressLabel(job) {
  const progress = normalizeProgress(job.progress);
  const base = progress == null ? '-' : `${progress}%`;
  const extras = [job.step, job.message].filter(Boolean).join(' • ');
  return extras ? `${base} • ${extras}` : base;
}

export default function Jobs() {
  const [searchParams] = useSearchParams();
  const initialJobType = (searchParams.get('jobType') || '').trim();

  const [activeTab, setActiveTab] = useState(initialJobType ? 'job-runs' : 'workfeed');

  const [workfeedJobs, setWorkfeedJobs] = useState([]);
  const [workfeedLoading, setWorkfeedLoading] = useState(true);
  const [workfeedPagination, setWorkfeedPagination] = useState({ total: 0, hasMore: false });
  const [workfeedPage, setWorkfeedPage] = useState(0);
  const [workfeedStatusFilter, setWorkfeedStatusFilter] = useState('active');
  const [workfeedWorkflowFilter, setWorkfeedWorkflowFilter] = useState('');
  const [workfeedJobIdFilter, setWorkfeedJobIdFilter] = useState('');
  const [workfeedAutoRefresh, setWorkfeedAutoRefresh] = useState(true);
  const [workfeedLastUpdated, setWorkfeedLastUpdated] = useState(null);
  const [selectedWorkfeedJobId, setSelectedWorkfeedJobId] = useState(null);
  const workfeedLoadCounterRef = useRef(0);

  const [jobRuns, setJobRuns] = useState([]);
  const [jobRunsLoading, setJobRunsLoading] = useState(true);
  const [jobRunsPagination, setJobRunsPagination] = useState({ total: 0, hasMore: false });
  const [jobRunsPage, setJobRunsPage] = useState(0);
  const [jobRunsStatusFilter, setJobRunsStatusFilter] = useState('');
  const [jobRunsTypeFilter, setJobRunsTypeFilter] = useState(initialJobType);
  const [jobRunsSearchJobId, setJobRunsSearchJobId] = useState('');
  const [selectedJobRunId, setSelectedJobRunId] = useState(null);
  const jobRunsLoadCounterRef = useRef(0);

  const limit = 50;

  const loadWorkfeed = useCallback(async () => {
    const loadToken = ++workfeedLoadCounterRef.current;
    try {
      setWorkfeedLoading(true);
      const params = {
        limit,
        offset: workfeedPage * limit,
      };
      if (workfeedStatusFilter && workfeedStatusFilter !== 'active') {
        params.status = workfeedStatusFilter;
      }
      if (workfeedWorkflowFilter.trim()) {
        params.workflowType = workfeedWorkflowFilter.trim();
      }
      if (workfeedJobIdFilter.trim()) {
        params.jobId = workfeedJobIdFilter.trim();
      }

      const response = await getWorkfeed(params);
      if (loadToken !== workfeedLoadCounterRef.current) return;

      setWorkfeedJobs(response.data.jobs || []);
      setWorkfeedPagination(response.data.pagination || { total: 0, hasMore: false });
      setWorkfeedLastUpdated(new Date());
    } catch (err) {
      if (loadToken !== workfeedLoadCounterRef.current) return;
      console.error('Failed to load workfeed:', err);
    } finally {
      if (loadToken === workfeedLoadCounterRef.current) {
        setWorkfeedLoading(false);
      }
    }
  }, [
    limit,
    workfeedPage,
    workfeedStatusFilter,
    workfeedWorkflowFilter,
    workfeedJobIdFilter,
  ]);

  const loadJobRuns = useCallback(async () => {
    const loadToken = ++jobRunsLoadCounterRef.current;
    try {
      setJobRunsLoading(true);
      const params = {
        limit,
        offset: jobRunsPage * limit,
        status: jobRunsStatusFilter || undefined,
        jobType: jobRunsTypeFilter || undefined,
        jobId: jobRunsSearchJobId.trim() || undefined,
      };
      const response = await getJobs(params);
      if (loadToken !== jobRunsLoadCounterRef.current) return;

      setJobRuns(response.data.jobs || []);
      setJobRunsPagination(response.data.pagination || { total: 0, hasMore: false });
    } catch (err) {
      if (loadToken !== jobRunsLoadCounterRef.current) return;
      console.error('Failed to load jobs:', err);
    } finally {
      if (loadToken === jobRunsLoadCounterRef.current) {
        setJobRunsLoading(false);
      }
    }
  }, [
    limit,
    jobRunsPage,
    jobRunsStatusFilter,
    jobRunsTypeFilter,
    jobRunsSearchJobId,
  ]);

  useEffect(() => {
    if (activeTab !== 'workfeed') return;
    loadWorkfeed();
  }, [activeTab, loadWorkfeed]);

  useEffect(() => {
    if (activeTab !== 'workfeed' || !workfeedAutoRefresh) return undefined;
    const timer = setInterval(() => {
      loadWorkfeed();
    }, WORKFEED_POLL_MS);
    return () => clearInterval(timer);
  }, [activeTab, workfeedAutoRefresh, loadWorkfeed]);

  useEffect(() => {
    if (activeTab !== 'job-runs') return;
    loadJobRuns();
  }, [activeTab, loadJobRuns]);

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Job Monitoring</h1>
        <div className="mt-3 sm:mt-0 flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {activeTab === 'workfeed' ? workfeedPagination.total : jobRunsPagination.total} records
          </span>
          {activeTab === 'workfeed' && (
            <button
              onClick={() => setWorkfeedAutoRefresh((v) => !v)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md border ${
                workfeedAutoRefresh
                  ? 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {workfeedAutoRefresh ? 'Auto-refresh ON' : 'Auto-refresh'}
            </button>
          )}
          <button
            onClick={activeTab === 'workfeed' ? loadWorkfeed : loadJobRuns}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-2 mb-6 inline-flex gap-2">
        <button
          onClick={() => setActiveTab('workfeed')}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            activeTab === 'workfeed'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          Workfeed
        </button>
        <button
          onClick={() => setActiveTab('job-runs')}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            activeTab === 'job-runs'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          Job Runs
        </button>
      </div>

      {activeTab === 'workfeed' ? (
        <>
          <div className="bg-white shadow rounded-lg p-4 mb-6">
            <div className="flex flex-wrap gap-4 items-center">
              <select
                value={workfeedStatusFilter}
                onChange={(e) => {
                  setWorkfeedStatusFilter(e.target.value);
                  setWorkfeedPage(0);
                }}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              >
                <option value="active">Active (queued + processing)</option>
                <option value="all">All Statuses</option>
                <option value="queued">Queued</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="aborted">Aborted</option>
              </select>

              <input
                type="text"
                value={workfeedWorkflowFilter}
                onChange={(e) => {
                  setWorkfeedWorkflowFilter(e.target.value);
                  setWorkfeedPage(0);
                }}
                placeholder="Filter workflow type..."
                className="min-w-[220px] rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />

              <input
                type="text"
                value={workfeedJobIdFilter}
                onChange={(e) => {
                  setWorkfeedJobIdFilter(e.target.value);
                  setWorkfeedPage(0);
                }}
                placeholder="Search by Job ID..."
                className="flex-1 min-w-[220px] rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Last updated: {workfeedLastUpdated ? workfeedLastUpdated.toLocaleTimeString() : 'never'}
            </p>
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden">
            {workfeedLoading ? (
              <div className="text-center py-12 text-gray-500">Loading workfeed...</div>
            ) : workfeedJobs.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No workflow jobs found</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Workflow Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Queue Position</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attempts</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shelf</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {workfeedJobs.map((job) => (
                        <tr
                          key={job.jobId}
                          onClick={() => setSelectedWorkfeedJobId(job.jobId)}
                          className="hover:bg-gray-50 cursor-pointer"
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-sm font-mono text-gray-900" title={job.jobId}>
                              {job.jobId?.length > 24 ? `${job.jobId.slice(0, 24)}...` : job.jobId}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                            {job.workflowType || '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${WORKFEED_STATUS_BADGE[job.status] || 'bg-gray-100 text-gray-800'}`}>
                              {job.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                            {job.status === 'queued' ? (job.queuePosition ?? '-') : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 max-w-[360px] truncate" title={buildWorkfeedProgressLabel(job)}>
                            {buildWorkfeedProgressLabel(job)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                            {(job.attemptCount ?? 0)}
                            {job.maxAttempts != null ? ` / ${job.maxAttempts}` : ''}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 font-mono">
                            {job.userId ? (job.userId.length > 12 ? `${job.userId.slice(0, 12)}...` : job.userId) : '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                            {job.shelfId ?? '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500" title={formatDateTime(job.updatedAt)}>
                            {formatRelativeTime(job.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  page={workfeedPage}
                  totalPages={Math.max(1, Math.ceil((workfeedPagination.total || 0) / limit))}
                  onPageChange={setWorkfeedPage}
                  total={workfeedPagination.total || 0}
                  pageSize={limit}
                />
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="bg-white shadow rounded-lg p-4 mb-6">
            <div className="flex flex-wrap gap-4">
              <select
                value={jobRunsStatusFilter}
                onChange={(e) => {
                  setJobRunsStatusFilter(e.target.value);
                  setJobRunsPage(0);
                }}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              >
                <option value="">All Status</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
              <select
                value={jobRunsTypeFilter}
                onChange={(e) => {
                  setJobRunsTypeFilter(e.target.value);
                  setJobRunsPage(0);
                }}
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
                value={jobRunsSearchJobId}
                onChange={(e) => setJobRunsSearchJobId(e.target.value)}
                placeholder="Search by Job ID..."
                className="flex-1 min-w-[200px] rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
              />
            </div>
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden">
            {jobRunsLoading ? (
              <div className="text-center py-12 text-gray-500">Loading jobs...</div>
            ) : jobRuns.length === 0 ? (
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
                      {jobRuns.map((job) => (
                        <tr
                          key={job.jobId}
                          onClick={() => setSelectedJobRunId(job.jobId)}
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
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${JOB_RUN_STATUS_BADGE[job.status] || 'bg-gray-100 text-gray-800'}`}>
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
                  page={jobRunsPage}
                  totalPages={Math.max(1, Math.ceil((jobRunsPagination.total || 0) / limit))}
                  onPageChange={setJobRunsPage}
                  total={jobRunsPagination.total || 0}
                  pageSize={limit}
                />
              </>
            )}
          </div>
        </>
      )}

      {selectedWorkfeedJobId && (
        <WorkfeedDetailModal
          jobId={selectedWorkfeedJobId}
          onClose={() => setSelectedWorkfeedJobId(null)}
        />
      )}

      {selectedJobRunId && (
        <JobDetailModal
          jobId={selectedJobRunId}
          onClose={() => setSelectedJobRunId(null)}
        />
      )}
    </div>
  );
}

