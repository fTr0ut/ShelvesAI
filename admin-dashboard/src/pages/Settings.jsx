import { useAuth } from '../context/AuthContext';

export default function Settings() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Admin Account
          </h3>
          <div className="mt-5 border-t border-gray-200 pt-5">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">Username</dt>
                <dd className="mt-1 text-sm text-gray-900">{user?.username || '-'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">User ID</dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono text-xs">{user?.id || '-'}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg mt-6">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            API Information
          </h3>
          <div className="mt-5 border-t border-gray-200 pt-5">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">API URL</dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono text-xs">
                  {import.meta.env.VITE_API_URL || '/api (proxied)'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Dashboard Version</dt>
                <dd className="mt-1 text-sm text-gray-900">1.0.0</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg mt-6 p-4">
        <h3 className="text-sm font-medium text-yellow-800">
          Admin Setup Reminder
        </h3>
        <p className="mt-2 text-sm text-yellow-700">
          To grant admin privileges to a user, run this command on the server:
        </p>
        <code className="mt-2 block bg-yellow-100 p-2 rounded text-xs text-yellow-900">
          cd api && node scripts/create-admin.js user@example.com
        </code>
      </div>
    </div>
  );
}
