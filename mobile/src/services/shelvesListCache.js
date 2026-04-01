const SHELVES_LIST_CACHE_TTL_MS = 60 * 1000;

const shelvesListCache = new Map();

function toSafeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSortBy(sortBy) {
  const value = String(sortBy || '').trim();
  if (value === 'type' || value === 'name' || value === 'createdAt' || value === 'updatedAt') {
    return value;
  }
  return 'createdAt';
}

function normalizeSortDir(sortDir) {
  return String(sortDir || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

export function buildShelvesListCacheKey({ limit = 50, skip = 0, sortBy = 'createdAt', sortDir = 'desc' } = {}) {
  const normalizedLimit = Math.max(1, toSafeInt(limit, 50));
  const normalizedSkip = Math.max(0, toSafeInt(skip, 0));
  return `${normalizedLimit}|${normalizedSkip}|${normalizeSortBy(sortBy)}|${normalizeSortDir(sortDir)}`;
}

export function getShelvesListCacheEntry(cacheKey, { now = Date.now() } = {}) {
  if (!cacheKey) return null;
  const entry = shelvesListCache.get(cacheKey);
  if (!entry || !entry.data) return null;
  if (!Number.isFinite(entry.cachedAt)) {
    shelvesListCache.delete(cacheKey);
    return null;
  }
  if (now - entry.cachedAt > SHELVES_LIST_CACHE_TTL_MS) {
    shelvesListCache.delete(cacheKey);
    return null;
  }
  return entry;
}

export function setShelvesListCacheEntry(cacheKey, { data, etag = null, cachedAt = Date.now() } = {}) {
  if (!cacheKey || !data) return null;
  const entry = {
    data,
    etag: etag || null,
    cachedAt: Number.isFinite(cachedAt) ? cachedAt : Date.now(),
  };
  shelvesListCache.set(cacheKey, entry);
  return entry;
}

export function clearShelvesListCache() {
  shelvesListCache.clear();
}

export function getShelvesListCacheTtlMs() {
  return SHELVES_LIST_CACHE_TTL_MS;
}
