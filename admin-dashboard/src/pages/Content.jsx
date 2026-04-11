import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getShelves } from '../api/client';
import UserAvatar from '../components/UserAvatar';
import Pagination from '../components/Pagination';
import ShelfDetailModal from '../components/ShelfDetailModal';

const SHELF_TYPES = ['all', 'books', 'movies', 'games', 'vinyl', 'other'];

const TYPE_COLORS = {
  books: 'bg-blue-100 text-blue-800',
  movies: 'bg-purple-100 text-purple-800',
  games: 'bg-green-100 text-green-800',
  vinyl: 'bg-orange-100 text-orange-800',
  other: 'bg-gray-100 text-gray-800',
};

export default function Content() {
  const [searchParams] = useSearchParams();
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedShelfId, setSelectedShelfId] = useState(null);
  const limit = 20;

  const loadShelves = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        limit,
        offset: page * limit,
        type: typeFilter === 'all' ? undefined : typeFilter,
        search: search || undefined,
      };
      const response = await getShelves(params);
      setShelves(response.data.shelves);
      setPagination(response.data.pagination);
    } catch (err) {
      console.error('Failed to load shelves:', err);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, search]);

  useEffect(() => {
    loadShelves();
  }, [loadShelves]);

  useEffect(() => {
    const selectedShelfId = searchParams.get('selectedShelfId');
    if (selectedShelfId) {
      setSelectedShelfId(selectedShelfId);
    }
  }, [searchParams]);

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(0);
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Content</h1>
        <span className="mt-3 sm:mt-0 text-sm text-gray-500">{pagination.total} shelves</span>
      </div>

      {/* Type Tabs */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-2 mb-4">
          {SHELF_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => { setTypeFilter(type); setPage(0); }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                typeFilter === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search shelf names..."
            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
          />
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Search
          </button>
        </form>
      </div>

      {/* Shelves Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading shelves...</div>
        ) : shelves.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No shelves found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shelf</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visibility</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {shelves.map((shelf) => (
                    <tr
                      key={shelf.id}
                      onClick={() => setSelectedShelfId(shelf.id)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{shelf.name}</div>
                        {shelf.description && (
                          <div className="text-xs text-gray-500 truncate max-w-xs">{shelf.description}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <UserAvatar user={{ username: shelf.ownerUsername, picture: shelf.ownerPicture }} size="8" />
                          <span className="ml-2 text-sm text-gray-900">{shelf.ownerUsername}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[shelf.type] || 'bg-gray-100 text-gray-800'}`}>
                          {shelf.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {shelf.itemCount || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {shelf.visibility}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {shelf.createdAt ? new Date(shelf.createdAt).toLocaleDateString() : '-'}
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

      {selectedShelfId && (
        <ShelfDetailModal
          shelfId={selectedShelfId}
          onClose={() => setSelectedShelfId(null)}
        />
      )}
    </div>
  );
}
