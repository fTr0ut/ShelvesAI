import { useState, useEffect } from 'react';
import { getShelf, getShelfItems } from '../api/client';
import UserAvatar from './UserAvatar';
import Pagination from './Pagination';
import { getErrorMessage } from '../utils/errorUtils';

const TYPE_COLORS = {
  books: 'bg-blue-100 text-blue-800',
  movies: 'bg-purple-100 text-purple-800',
  games: 'bg-green-100 text-green-800',
  vinyl: 'bg-orange-100 text-orange-800',
  other: 'bg-gray-100 text-gray-800',
};

export default function ShelfDetailModal({ shelfId, onClose }) {
  const [shelf, setShelf] = useState(null);
  const [items, setItems] = useState([]);
  const [itemPagination, setItemPagination] = useState({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    if (shelfId) loadShelf();
  }, [shelfId]);

  useEffect(() => {
    if (shelfId) loadItems();
  }, [shelfId, page]);

  async function loadShelf() {
    try {
      setLoading(true);
      setError(null);
      const response = await getShelf(shelfId);
      setShelf(response.data.shelf);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load shelf'));
    } finally {
      setLoading(false);
    }
  }

  async function loadItems() {
    try {
      setItemsLoading(true);
      const response = await getShelfItems(shelfId, { limit, offset: page * limit });
      setItems(response.data.items);
      setItemPagination(response.data.pagination);
    } catch (err) {
      console.error('Failed to load items:', err);
    } finally {
      setItemsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Shelf Details</h3>
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
          ) : shelf ? (
            <div className="space-y-6">
              {/* Shelf Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xl font-semibold text-gray-900">{shelf.name}</h4>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[shelf.type] || 'bg-gray-100 text-gray-800'}`}>
                      {shelf.type}
                    </span>
                    <span className="text-xs text-gray-500">{shelf.visibility}</span>
                    <span className="text-xs text-gray-500">{shelf.itemCount || 0} items</span>
                  </div>
                </div>
              </div>

              {/* Owner */}
              <div className="flex items-center gap-3">
                <UserAvatar user={{ username: shelf.ownerUsername, picture: shelf.ownerPicture }} size="10" />
                <div>
                  <div className="text-sm font-medium text-gray-900">{shelf.ownerUsername}</div>
                  <div className="text-xs text-gray-500">Owner</div>
                </div>
              </div>

              {shelf.description && (
                <div className="text-sm text-gray-600">{shelf.description}</div>
              )}

              {/* Items */}
              <div className="border-t border-gray-200 pt-4">
                <h5 className="text-sm font-semibold text-gray-700 mb-3">Items</h5>
                {itemsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading items...</div>
                ) : items.length === 0 ? (
                  <div className="text-center py-4 text-gray-400">No items on this shelf</div>
                ) : (
                  <div className="space-y-2">
                    {items.map((item) => {
                      const title = item.title || item.manualName || 'Untitled';
                      const creator = item.primaryCreator || item.manualAuthor || '';
                      const kind = item.kind || item.manualType || '';

                      return (
                        <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                          {item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt=""
                              className="h-12 w-9 object-cover rounded shadow-sm flex-shrink-0"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="h-12 w-9 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                              <span className="text-xs text-gray-400">?</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
                            <div className="text-xs text-gray-500 truncate">
                              {creator && <span>{creator}</span>}
                              {creator && kind && <span> &middot; </span>}
                              {kind && <span>{kind}</span>}
                              {item.year && <span> ({item.year})</span>}
                            </div>
                          </div>
                          {item.format && (
                            <span className="text-xs text-gray-400">{item.format}</span>
                          )}
                          {item.rating != null && (
                            <span className="text-xs text-yellow-600">{item.rating}/5</span>
                          )}
                        </div>
                      );
                    })}

                    {itemPagination.total > limit && (
                      <Pagination
                        page={page}
                        totalPages={Math.ceil(itemPagination.total / limit)}
                        onPageChange={setPage}
                        total={itemPagination.total}
                        pageSize={limit}
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-400">
                Created {shelf.createdAt ? new Date(shelf.createdAt).toLocaleString() : '-'}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
