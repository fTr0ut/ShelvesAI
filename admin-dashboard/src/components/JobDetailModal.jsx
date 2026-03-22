import { useState, useEffect } from 'react';
import { getJob } from '../api/client';
import { getErrorMessage } from '../utils/errorUtils';

const LEVEL_COLORS = {
  info: 'text-gray-600',
  warn: 'text-yellow-700',
  error: 'text-red-600',
  debug: 'text-blue-600',
};

const LEVEL_BG = {
  info: 'bg-gray-50',
  warn: 'bg-yellow-50',
  error: 'bg-red-50',
  debug: 'bg-blue-50',
};

const STATUS_BADGE = {
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default function JobDetailModal({ jobId, onClose }) {
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (jobId) loadJob();
  }, [jobId]);

  async function loadJob() {
    try {
      setLoading(true);
      setError(null);
      const response = await getJob(jobId);
      setJob(response.data.job);
      setEvents(response.data.events || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load job'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Job Details</h3>
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
          ) : job ? (
            <div className="space-y-6">
              {/* Job Meta */}
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[job.status] || 'bg-gray-100 text-gray-800'}`}>
                  {job.status}
                </span>
                <span className="text-sm text-gray-500 font-mono">{job.jobId}</span>
              </div>

              {job.errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                  <h5 className="text-sm font-medium text-red-800">Error</h5>
                  <p className="mt-1 text-sm text-red-700 font-mono whitespace-pre-wrap">{job.errorMessage}</p>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs font-medium text-gray-500">Type</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.jobType || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Name</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.jobName || '-'}</dd>
                </div>
                {job.httpMethod && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">HTTP</dt>
                    <dd className="mt-1 text-sm text-gray-900 font-mono">
                      {job.httpMethod} {job.httpPath}
                      {job.httpStatus && <span className="ml-2 text-gray-500">({job.httpStatus})</span>}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-medium text-gray-500">Duration</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.durationMs != null ? `${job.durationMs}ms` : '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Started</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.startedAt ? new Date(job.startedAt).toLocaleString() : '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Finished</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '-'}</dd>
                </div>
                {job.ipAddress && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">IP Address</dt>
                    <dd className="mt-1 text-sm text-gray-900 font-mono">{job.ipAddress}</dd>
                  </div>
                )}
                {job.userId && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">User ID</dt>
                    <dd className="mt-1 text-sm text-gray-900 font-mono text-xs">{job.userId}</dd>
                  </div>
                )}
              </dl>

              {job.metadata && Object.keys(job.metadata).length > 0 && (
                <div>
                  <h5 className="text-xs font-medium text-gray-500 mb-2">Metadata</h5>
                  <pre className="bg-gray-50 rounded p-3 text-xs font-mono text-gray-700 overflow-x-auto">
                    {JSON.stringify(job.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {/* Event Trail */}
              {events.length > 0 && (
                <div>
                  <h5 className="text-sm font-semibold text-gray-700 mb-3">Event Trail ({events.length})</h5>
                  <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                    {events.map((event, i) => (
                      <div key={event.id || i} className={`px-4 py-2 text-xs border-b border-gray-100 last:border-b-0 ${LEVEL_BG[event.level] || ''}`}>
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold uppercase w-12 ${LEVEL_COLORS[event.level] || 'text-gray-600'}`}>
                            {event.level}
                          </span>
                          <span className="text-gray-500">
                            {event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : ''}
                          </span>
                          <span className="text-gray-800 flex-1">{event.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
