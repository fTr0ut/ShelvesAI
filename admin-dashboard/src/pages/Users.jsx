import { useState, useEffect, useCallback } from 'react';
import { getUsers } from '../api/client';
import UserTable from '../components/UserTable';
import UserDetailModal from '../components/UserDetailModal';
import Pagination from '../components/Pagination';

const SEARCH_DEBOUNCE_MS = 400;

function toFilterOptionValue(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
}

function fromFilterOptionValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [queryState, setQueryState] = useState({
    page: 0,
    suspended: undefined,
    admin: undefined,
  });
  const limit = 20;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      setSearch(nextSearch);
      setQueryState((prev) => (prev.page === 0 ? prev : { ...prev, page: 0 }));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        limit,
        offset: queryState.page * limit,
        search: search || undefined,
        suspended: queryState.suspended,
        admin: queryState.admin,
      };
      const response = await getUsers(params);
      setUsers(response.data.users);
      setPagination(response.data.pagination);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [queryState.page, queryState.suspended, queryState.admin, search]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  function handleSearch(e) {
    e.preventDefault();
    const nextSearch = searchInput.trim();
    setSearch(nextSearch);
    setQueryState((prev) => (prev.page === 0 ? prev : { ...prev, page: 0 }));
  }

  function handleFilterChange(key, value) {
    const parsedValue = fromFilterOptionValue(value);
    setQueryState((prev) => ({ ...prev, [key]: parsedValue, page: 0 }));
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
        <div className="mt-3 sm:mt-0 text-sm text-gray-500">
          {pagination.total} total users
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search users..."
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
            />
          </div>
          <select
            value={toFilterOptionValue(queryState.suspended)}
            onChange={(e) => handleFilterChange('suspended', e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          >
            <option value="">All Status</option>
            <option value="false">Active</option>
            <option value="true">Suspended</option>
          </select>
          <select
            value={toFilterOptionValue(queryState.admin)}
            onChange={(e) => handleFilterChange('admin', e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          >
            <option value="">All Roles</option>
            <option value="true">Admins</option>
            <option value="false">Users</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Search
          </button>
        </form>
      </div>

      {/* User Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <UserTable
          users={users}
          loading={loading}
          onUserClick={(user) => setSelectedUserId(user.id)}
        />

        {/* Pagination */}
        {!loading && users.length > 0 && (
          <Pagination
            page={queryState.page}
            totalPages={Math.ceil(pagination.total / limit)}
            onPageChange={(newPage) => setQueryState((prev) => ({ ...prev, page: newPage }))}
            total={pagination.total}
            pageSize={limit}
          />
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUserId && (
        <UserDetailModal
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onUpdate={loadUsers}
        />
      )}
    </div>
  );
}
