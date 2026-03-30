import { useEffect, useState } from 'react';
import { getWorkfeedJob } from '../api/client';
import { getErrorMessage } from '../utils/errorUtils';

const STATUS_BADGE = {
  queued: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  aborted: 'bg-gray-100 text-gray-800',
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function JsonBlock({ title, value }) {
  const hasValue = value !== null && value !== undefined;
  return (
    <div>
      <h5 className="text-xs font-medium text-gray-500 mb-2">{title}</h5>
      <pre className="bg-gray-50 rounded p-3 text-xs font-mono text-gray-700 overflow-x-auto max-h-56">
        {hasValue ? JSON.stringify(value, null, 2) : 'null'}
      </pre>
    </div>
  );
}

export default function WorkfeedDetailModal({ jobId, onClose }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await getWorkfeedJob(jobId);
        if (cancelled) return;
        setJob(response.data.job || null);
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Failed to load workfeed job'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Workfeed Job Details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <div className="text-center py-8">Loading...</div>
          ) : error ? (
            <div className="text-center py-8 text-red-600">{error}</div>
          ) : !job ? (
            <div className="text-center py-8 text-gray-500">Job not found</div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[job.status] || 'bg-gray-100 text-gray-800'}`}>
                  {job.status}
                </span>
                <span className="text-sm text-gray-500 font-mono">{job.jobId}</span>
              </div>

              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs font-medium text-gray-500">Workflow Type</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.workflowType || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Priority</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.priority ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Attempts</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {job.attemptCount ?? 0}
                    {job.maxAttempts != null ? ` / ${job.maxAttempts}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Queue Position</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.queuePosition ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Queued Time</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {job.queuedMs != null ? `${Math.max(0, Math.floor(job.queuedMs / 1000))}s` : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Progress</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {job.progress != null ? `${job.progress}%` : '-'}
                    {job.step ? ` • ${job.step}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Message</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.message || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Notify On Complete</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.notifyOnComplete ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">User ID</dt>
                  <dd className="mt-1 text-sm text-gray-900 font-mono break-all">{job.userId || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Shelf ID</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.shelfId ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Created</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(job.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Updated</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(job.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Claimed</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(job.claimedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Started</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(job.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Finished</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(job.finishedAt)}</dd>
                </div>
              </dl>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <JsonBlock title="Payload" value={job.payload} />
                <JsonBlock title="Result" value={job.result} />
                <JsonBlock title="Error" value={job.error} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

