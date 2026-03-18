/**
 * Controlled pagination component.
 *
 * Required props:
 *   page        {number}   0-based current page index
 *   totalPages  {number}   total number of pages
 *   onPageChange {function} called with the new 0-based page index
 *
 * Optional props:
 *   total     {number}  total record count (enables "Showing X to Y of Z" text)
 *   pageSize  {number}  records per page (required when total is provided)
 *   className {string}  extra class names for the wrapper element
 */
export default function Pagination({ page, totalPages, onPageChange, total, pageSize, className }) {
  const isFirstPage = page === 0;
  const isLastPage = page >= totalPages - 1;

  return (
    <div className={`bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200${className ? ` ${className}` : ''}`}>
      {/* Mobile */}
      <div className="flex-1 flex justify-between sm:hidden">
        <button
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={isFirstPage}
          className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={isLastPage}
          className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {/* Desktop */}
      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <div>
          {total != null && pageSize != null ? (
            <p className="text-sm text-gray-700">
              Showing{' '}
              <span className="font-medium">{page * pageSize + 1}</span> to{' '}
              <span className="font-medium">{Math.min((page + 1) * pageSize, total)}</span>{' '}
              of <span className="font-medium">{total}</span> results
            </p>
          ) : (
            <p className="text-sm text-gray-700">
              Page <span className="font-medium">{page + 1}</span> of{' '}
              <span className="font-medium">{totalPages}</span>
            </p>
          )}
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
            <button
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={isFirstPage}
              className="relative inline-flex items-center px-4 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={isLastPage}
              className="relative inline-flex items-center px-4 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
