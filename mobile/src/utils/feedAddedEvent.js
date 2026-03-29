import { resolveCollectableCoverUrl, resolveManualCoverUrl } from './coverUrl';

const SHELF_TYPE_NOUNS = {
    books: { singular: 'book', plural: 'books' },
    book: { singular: 'book', plural: 'books' },
    movies: { singular: 'movie', plural: 'movies' },
    movie: { singular: 'movie', plural: 'movies' },
    games: { singular: 'game', plural: 'games' },
    game: { singular: 'game', plural: 'games' },
    tv: { singular: 'tv show', plural: 'tv shows' },
    'tv show': { singular: 'tv show', plural: 'tv shows' },
    tvshow: { singular: 'tv show', plural: 'tv shows' },
    'tv-show': { singular: 'tv show', plural: 'tv shows' },
    vinyl: { singular: 'record', plural: 'records' },
    vinyls: { singular: 'record', plural: 'records' },
    record: { singular: 'record', plural: 'records' },
    records: { singular: 'record', plural: 'records' },
    other: { singular: 'item', plural: 'items' },
    item: { singular: 'item', plural: 'items' },
    items: { singular: 'item', plural: 'items' },
};

function normalizeShelfType(value) {
    return String(value || '').trim().toLowerCase() || 'other';
}

function resolveNouns(shelfType) {
    return SHELF_TYPE_NOUNS[normalizeShelfType(shelfType)] || SHELF_TYPE_NOUNS.other;
}

export function isAddedEventType(eventType) {
    return (
        eventType === 'item.added'
        || eventType === 'item.collectable_added'
        || eventType === 'item.manual_added'
    );
}

export function resolveAddedEventCount(entry = {}) {
    const eventItemCount = Number(entry?.eventItemCount);
    if (Number.isFinite(eventItemCount) && eventItemCount > 0) return Math.trunc(eventItemCount);
    if (Array.isArray(entry?.items) && entry.items.length > 0) return entry.items.length;
    return 1;
}

export function formatAddedEventHeader({
    shelf = {},
    eventItemCount = null,
    items = [],
}) {
    const shelfType = normalizeShelfType(shelf?.type);
    const shelfName = shelf?.name || 'this shelf';
    const fallbackCount = Number(eventItemCount);
    const count = Number.isFinite(fallbackCount) && fallbackCount > 0
        ? Math.trunc(fallbackCount)
        : (Array.isArray(items) && items.length > 0 ? items.length : 1);
    const nouns = resolveNouns(shelfType);

    if (shelfType === 'other') {
        if (count <= 1) return `Added 1 new item to their ${shelfName} shelf.`;
        return `Added ${count} new items to their ${shelfName} shelf.`;
    }

    if (count <= 1) return `Added a new ${nouns.singular} to ${shelfName}.`;
    return `Added ${count} new ${nouns.plural} to ${shelfName}.`;
}

export function getAddedItemDetails(item = {}, apiBase = '') {
    const collectable = item?.collectable || item?.collectableSnapshot || null;
    const manual = item?.manual || item?.manualSnapshot || null;
    const payload = item?.payload || null;

    const name = (
        item?.title
        || collectable?.title
        || manual?.name
        || manual?.title
        || payload?.title
        || payload?.name
        || 'Unknown item'
    );
    const creator = (
        item?.creator
        || item?.primaryCreator
        || collectable?.primaryCreator
        || manual?.author
        || payload?.creator
        || payload?.primaryCreator
        || payload?.author
        || null
    );
    const year = (
        item?.year
        || collectable?.year
        || manual?.year
        || payload?.year
        || null
    );
    const coverUrl = (
        resolveCollectableCoverUrl(collectable, apiBase)
        || resolveManualCoverUrl(manual, apiBase)
        || null
    );
    const collectableId = (
        item?.collectableId
        || item?.collectable_id
        || collectable?.id
        || payload?.collectableId
        || payload?.collectable_id
        || null
    );
    // Only trust explicit collection item ids for owner-photo thumbnail lookups.
    const itemId = item?.itemId || payload?.itemId || payload?.item_id || null;
    const rating = item?.rating ?? payload?.rating ?? null;

    return {
        name,
        creator,
        year,
        coverUrl,
        collectableId,
        itemId,
        isManual: !collectableId,
        rating,
    };
}

export function getAddedPreviewItems(items = [], apiBase = '', limit = 3) {
    if (!Array.isArray(items) || items.length === 0) return [];
    return items.slice(0, limit).map((item) => getAddedItemDetails(item, apiBase));
}

export function buildOwnerPhotoThumbnailUri({ apiBase = '', shelfId, itemId, updatedAt = null }) {
    if (!shelfId || !itemId) return null;
    const base = `${String(apiBase || '').replace(/\/+$/, '')}/api/shelves/${shelfId}/items/${itemId}/owner-photo/thumbnail`;
    const ts = updatedAt ? new Date(updatedAt).getTime() : NaN;
    if (!Number.isFinite(ts)) return base;
    return `${base}${base.includes('?') ? '&' : '?'}v=${ts}`;
}
