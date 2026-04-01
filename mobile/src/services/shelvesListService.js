import { apiRequest } from './api';
import {
  buildShelvesListCacheKey,
  getShelvesListCacheEntry,
  setShelvesListCacheEntry,
} from './shelvesListCache';

const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_SORT_BY = 'createdAt';
const DEFAULT_SORT_DIR = 'desc';

function normalizeSortBy(sortBy) {
  const value = String(sortBy || '').trim();
  if (value === 'type' || value === 'name' || value === 'createdAt' || value === 'updatedAt') {
    return value;
  }
  return DEFAULT_SORT_BY;
}

function normalizeSortDir(sortDir) {
  return String(sortDir || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function toPageLimit(value, fallback = DEFAULT_PAGE_LIMIT) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toPageSkip(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function buildShelvesListPath({ limit = DEFAULT_PAGE_LIMIT, skip = 0, sortBy = DEFAULT_SORT_BY, sortDir = DEFAULT_SORT_DIR } = {}) {
  const normalizedLimit = toPageLimit(limit, DEFAULT_PAGE_LIMIT);
  const normalizedSkip = toPageSkip(skip, 0);
  const normalizedSortBy = normalizeSortBy(sortBy);
  const normalizedSortDir = normalizeSortDir(sortDir);
  return `/api/shelves?limit=${normalizedLimit}&skip=${normalizedSkip}&sortBy=${encodeURIComponent(normalizedSortBy)}&sortDir=${normalizedSortDir}`;
}

export async function fetchShelvesPage({
  apiBase,
  token,
  limit = DEFAULT_PAGE_LIMIT,
  skip = 0,
  sortBy = DEFAULT_SORT_BY,
  sortDir = DEFAULT_SORT_DIR,
  forceRefresh = false,
} = {}) {
  const normalizedLimit = toPageLimit(limit, DEFAULT_PAGE_LIMIT);
  const normalizedSkip = toPageSkip(skip, 0);
  const normalizedSortBy = normalizeSortBy(sortBy);
  const normalizedSortDir = normalizeSortDir(sortDir);
  const cacheKey = buildShelvesListCacheKey({
    limit: normalizedLimit,
    skip: normalizedSkip,
    sortBy: normalizedSortBy,
    sortDir: normalizedSortDir,
  });
  const cached = forceRefresh ? null : getShelvesListCacheEntry(cacheKey);
  const path = buildShelvesListPath({
    limit: normalizedLimit,
    skip: normalizedSkip,
    sortBy: normalizedSortBy,
    sortDir: normalizedSortDir,
  });

  let response = await apiRequest({
    apiBase,
    path,
    token,
    allowNotModified: true,
    ifNoneMatch: cached?.etag || undefined,
    onNotModified: () => cached?.data || null,
    returnMeta: true,
  });

  let pageData = response?.data;
  if (!pageData || !Array.isArray(pageData.shelves)) {
    if (response?.status === 304 && cached?.data) {
      pageData = cached.data;
      setShelvesListCacheEntry(cacheKey, { data: cached.data, etag: cached.etag });
    } else {
      response = await apiRequest({ apiBase, path, token, returnMeta: true });
      pageData = response?.data;
    }
  }

  if (pageData && Array.isArray(pageData.shelves)) {
    const etag = response?.headers?.etag || cached?.etag || null;
    setShelvesListCacheEntry(cacheKey, { data: pageData, etag });
    return pageData;
  }

  return {
    shelves: [],
    pagination: {
      limit: normalizedLimit,
      skip: normalizedSkip,
      total: 0,
      hasMore: false,
    },
    sort: { sortBy: normalizedSortBy, sortDir: normalizedSortDir },
  };
}

export async function fetchAllShelves({
  apiBase,
  token,
  limit = DEFAULT_PAGE_LIMIT,
  sortBy = DEFAULT_SORT_BY,
  sortDir = DEFAULT_SORT_DIR,
  forceRefresh = false,
  maxPages = 100,
} = {}) {
  const normalizedLimit = toPageLimit(limit, DEFAULT_PAGE_LIMIT);
  const normalizedSortBy = normalizeSortBy(sortBy);
  const normalizedSortDir = normalizeSortDir(sortDir);
  const shelves = [];
  const seenIds = new Set();

  let skip = 0;
  let pageCount = 0;
  let total = 0;
  let hasMore = false;

  while (pageCount < maxPages) {
    const page = await fetchShelvesPage({
      apiBase,
      token,
      limit: normalizedLimit,
      skip,
      sortBy: normalizedSortBy,
      sortDir: normalizedSortDir,
      forceRefresh: forceRefresh && pageCount === 0,
    });
    const pageShelves = Array.isArray(page?.shelves) ? page.shelves : [];
    total = Number.isFinite(Number(page?.pagination?.total))
      ? Number(page.pagination.total)
      : total;
    hasMore = Boolean(page?.pagination?.hasMore);

    for (const shelf of pageShelves) {
      const shelfId = Number(shelf?.id);
      const dedupeKey = Number.isFinite(shelfId) ? `id:${shelfId}` : `raw:${JSON.stringify(shelf)}`;
      if (seenIds.has(dedupeKey)) continue;
      seenIds.add(dedupeKey);
      shelves.push(shelf);
    }

    pageCount += 1;
    if (!hasMore || pageShelves.length === 0) break;
    skip += normalizedLimit;
  }

  return {
    shelves,
    pagination: {
      limit: normalizedLimit,
      skip: 0,
      total: total || shelves.length,
      hasMore: false,
    },
    sort: {
      sortBy: normalizedSortBy,
      sortDir: normalizedSortDir,
    },
  };
}
