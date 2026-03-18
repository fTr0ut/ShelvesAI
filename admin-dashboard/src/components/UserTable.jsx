import UserAvatar from './UserAvatar';
import { SuspendedBadge, AdminBadge } from './UserBadge';

export default function UserTable({ users, onUserClick, loading }) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-500">Loading users...</div>
      </div>
    );
  }

  if (!users || users.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-500">No users found</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              User
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Email
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Role
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Joined
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {users.map((user) => (
            <tr
              key={user.id}
              onClick={() => onUserClick(user)}
              className="hover:bg-gray-50 cursor-pointer"
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="h-10 w-10 flex-shrink-0">
                    <UserAvatar user={user} size="10" />
                  </div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-gray-900">
                      {user.username || 'No username'}
                    </div>
                    {(user.firstName || user.lastName) && (
                      <div className="text-sm text-gray-500">
                        {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900">{user.email || '-'}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <SuspendedBadge isSuspended={user.isSuspended} variant="sm" />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <AdminBadge isAdmin={user.isAdmin} variant="sm" />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString()
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
