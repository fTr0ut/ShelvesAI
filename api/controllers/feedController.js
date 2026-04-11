const feedQueries = require('../database/queries/feed');
const shelvesQueries = require('../database/queries/shelves');
const friendshipQueries = require('../database/queries/friendships');
const eventSocialQueries = require('../database/queries/eventSocial');
const { markNewsItemsSeen } = require('../database/queries/newsSeen');
const { query } = require('../database/pg');
const { getNewsRecommendationsForUser } = require('../services/discovery/newsRecommendations');
const { rowToCamelCase, parsePagination } = require('../database/queries/utils');
const { resolveMediaUrl } = require('../services/mediaUrl');
const { PREVIEW_PAYLOAD_LIMIT } = require('../config/constants');
const { ensureUsersNotBlocked } = require('../utils/userBlockAccess');
const logger = require('../logger');

const OTHER_SHELF_TYPE = 'other';
const NEWS_FEED_GROUP_LIMIT = parseInt(process.env.NEWS_FEED_GROUP_LIMIT || '3', 10);
const NEWS_FEED_ITEMS_PER_GROUP = parseInt(process.env.NEWS_FEED_ITEMS_PER_GROUP || '3', 10);
const NEWS_FEED_INSERT_INTERVAL = parseInt(process.env.NEWS_FEED_INSERT_INTERVAL || '3', 10);

function getDisplayHints(eventType) {
  const hints = {
    default: {
      showShelfCard: true,
      sectionTitle: 'Newly added collectibles',
      itemDisplayMode: 'numbered',
    },
    'news.recommendation': {
      showShelfCard: false,
      sectionTitle: 'Discover picks',
      itemDisplayMode: 'news',
    },
    'item.rated': {
      showShelfCard: false,
      sectionTitle: 'New ratings',
      itemDisplayMode: 'rated',
    },
    reviewed: {
      showShelfCard: false,
      sectionTitle: 'Reviewed',
      itemDisplayMode: 'reviewed',
    },
    'checkin.activity': {
      showShelfCard: false,
      sectionTitle: null,
      itemDisplayMode: 'checkin',
    },
    'checkin.rated': {
      showShelfCard: false,
      sectionTitle: null,
      itemDisplayMode: 'checkin-rated',
    },
    'shelf.created': {
      showShelfCard: true,
      sectionTitle: 'New shelf',
      itemDisplayMode: 'numbered',
    },
  };
  return hints[eventType] || hints.default;
}

const NEWS_CATEGORY_LABELS = {
  movies: 'Movies',
  tv: 'TV',
  games: 'Games',
  books: 'Books',
  vinyl: 'Vinyl',
};

const NEWS_ITEM_TYPE_LABELS = {
  trending: 'Trending',
  upcoming: 'Upcoming',
  now_playing: 'Now Playing',
  recent: 'Recent',
  preorder_4k: '4K Preorders',
  new_release_4k: 'New 4K Releases',
  upcoming_4k: 'Upcoming 4K Releases',
  preorder_bluray: 'Blu-ray Preorders',
  new_release_bluray: 'New Blu-ray Releases',
  upcoming_bluray: 'Upcoming Blu-ray Releases',
};

function formatNewsSectionTitle(category, itemType) {
  const typeLabel = NEWS_ITEM_TYPE_LABELS[itemType] || itemType.replace(/_/g, ' ');
  const categoryLabel = NEWS_CATEGORY_LABELS[category] || category;
  if (/4k|bluray/i.test(itemType)) return typeLabel;
  return `${typeLabel} ${categoryLabel}`.trim();
}

function buildNewsFeedTags(category, itemType) {
  const tags = ['news', 'discover', category, itemType];
  if (/4k/i.test(itemType)) tags.push('format:4k');
  if (/bluray/i.test(itemType)) tags.push('format:bluray');
  return tags;
}

function buildNewsRecommendationEntries(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return [];

  return groups.map((group) => {
    const createdAt = group.latestDate ? new Date(group.latestDate).toISOString() : new Date().toISOString();
    const sectionTitle = formatNewsSectionTitle(group.category, group.itemType);
    const groupKey = `${group.category}:${group.itemType}`;
    const items = (group.items || []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description || null,
      coverImageUrl: item.coverImageUrl || null,
      releaseDate: item.releaseDate || null,
      physicalReleaseDate: item.physicalReleaseDate || null,
      sourceUrl: item.sourceUrl || null,
      sourceApi: item.sourceApi || null,
      category: item.category,
      itemType: item.itemType,
      relevanceScore: item.relevanceScore || 0,
      reasons: item.reasons || [],
      collectableId: item.collectableId || null,
      collectable: {
        id: item.collectableId || null,
        title: item.title,
        primaryCreator: item.collectablePrimaryCreator || null,
        coverUrl: item.coverImageUrl || null,
        kind: item.collectableKind || item.category || null,
      },
    }));

    return {
      id: `news:${groupKey}`,
      aggregateId: null,
      eventType: 'news.recommendation',
      origin: 'news_items',
      filterKey: 'news_items',
      feedTags: buildNewsFeedTags(group.category, group.itemType),
      createdAt,
      updatedAt: createdAt,
      eventItemCount: items.length,
      owner: {
        id: null,
        username: 'Discover',
        name: 'Discover',
      },
      items,
      displayHints: {
        showShelfCard: false,
        sectionTitle,
        itemDisplayMode: 'news',
      },
      metadata: {
        groupKey,
        maxScore: group.maxScore || null,
      },
    };
  });
}

function extractNewsItemIdsFromEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const ids = new Set();
  entries.forEach((entry) => {
    if (!entry || entry.eventType !== 'news.recommendation') return;
    const items = Array.isArray(entry.items) ? entry.items : [];
    items.forEach((item) => {
      const parsed = parseInt(item?.id, 10);
      if (Number.isFinite(parsed)) ids.add(parsed);
    });
  });
  return Array.from(ids);
}

async function markNewsEntriesSeen(userId, entries) {
  if (!userId) return;
  const ids = extractNewsItemIdsFromEntries(entries);
  if (!ids.length) return;
  try {
    await markNewsItemsSeen(userId, ids);
  } catch (err) {
    logger.warn('[Feed] Failed to mark news items seen:', err.message);
  }
}

function interleaveEntries(baseEntries, insertEntries, interval) {
  if (!insertEntries.length) return baseEntries;
  if (!baseEntries.length) return insertEntries;

  const resolvedInterval = Number.isFinite(interval) && interval > 0 ? interval : 3;
  const result = [];
  let insertIndex = 0;

  for (let i = 0; i < baseEntries.length; i += 1) {
    result.push(baseEntries[i]);
    if ((i + 1) % resolvedInterval === 0 && insertIndex < insertEntries.length) {
      result.push(insertEntries[insertIndex]);
      insertIndex += 1;
    }
  }

  while (insertIndex < insertEntries.length) {
    result.push(insertEntries[insertIndex]);
    insertIndex += 1;
  }

  return result;
}

function flattenPayloadItems(payloads) {
  const out = [];
  if (!Array.isArray(payloads)) return out;
  payloads.forEach((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.items)) {
      payload.items.forEach((item) => {
        if (item && typeof item === 'object') out.push(item);
      });
      return;
    }
    out.push(payload);
  });
  return out;
}

function getPayloadField(payload, fields, fallback = null) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(fields)) return fallback;
  for (const field of fields) {
    if (payload[field] !== undefined && payload[field] !== null) {
      return payload[field];
    }
  }
  return fallback;
}

function resolveCoverMediaUrl(coverMediaPath, coverMediaUrl = null) {
  return coverMediaUrl || resolveMediaUrl(coverMediaPath);
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function collectManualCoverCandidates(entries = []) {
  const itemIds = new Set();
  const manualIds = new Set();
  const ownerIds = new Set();

  const collectCandidate = (item, ownerId) => {
    if (!item || typeof item !== 'object' || !ownerId) return;
    const manualId = parsePositiveInt(item.manual?.id ?? item.manualId);
    if (!manualId) return;

    const itemId = parsePositiveInt(item.itemId ?? item.id);
    if (itemId) itemIds.add(itemId);
    manualIds.add(manualId);
    ownerIds.add(String(ownerId));
  };

  entries.forEach((entry) => {
    const ownerId = entry?.owner?.id;
    if (!ownerId) return;

    if (Array.isArray(entry.items)) {
      entry.items.forEach((item) => collectCandidate(item, ownerId));
    }

    if (entry.manual || entry.manualId) {
      collectCandidate({
        itemId: entry.itemId ?? null,
        manualId: entry.manual?.id ?? entry.manualId ?? null,
        manual: entry.manual || null,
      }, ownerId);
    }
  });

  return {
    itemIds: Array.from(itemIds),
    manualIds: Array.from(manualIds),
    ownerIds: Array.from(ownerIds),
  };
}

async function loadManualCoverPrivacyLookup({ itemIds = [], manualIds = [], ownerIds = [] }) {
  if (!itemIds.length && !manualIds.length) {
    return {
      byItemId: new Map(),
      byManualOwnerKey: new Map(),
      byManualId: new Map(),
    };
  }

  const conditions = [];
  const params = [];

  if (itemIds.length) {
    params.push(itemIds);
    conditions.push(`uc.id = ANY($${params.length}::int[])`);
  }
  if (manualIds.length) {
    params.push(manualIds);
    conditions.push(`uc.manual_id = ANY($${params.length}::int[])`);
  }

  let ownerFilter = '';
  if (ownerIds.length) {
    params.push(ownerIds.map((id) => String(id)));
    ownerFilter = ` AND uc.user_id::text = ANY($${params.length}::text[])`;
  }

  const result = await query(
    `SELECT uc.id AS collection_item_id,
            uc.manual_id,
            uc.user_id::text AS owner_id,
            s.type AS shelf_type,
            uc.owner_photo_source,
            uc.owner_photo_visible,
            u.show_personal_photos
     FROM user_collections uc
     JOIN shelves s ON s.id = uc.shelf_id
     JOIN users u ON u.id = uc.user_id
     WHERE (${conditions.join(' OR ')})${ownerFilter}`,
    params,
  );

  const byItemId = new Map();
  const byManualOwnerKey = new Map();
  const byManualId = new Map();

  result.rows.forEach((row) => {
    const itemId = parsePositiveInt(row.collection_item_id);
    const manualId = parsePositiveInt(row.manual_id);
    const ownerId = row.owner_id ? String(row.owner_id) : null;
    const normalized = {
      itemId,
      manualId,
      ownerId,
      shelfType: row.shelf_type || null,
      ownerPhotoSource: row.owner_photo_source || null,
      ownerPhotoVisible: row.owner_photo_visible === true,
      showPersonalPhotos: row.show_personal_photos === true,
    };

    if (itemId && !byItemId.has(String(itemId))) {
      byItemId.set(String(itemId), normalized);
    }
    if (manualId) {
      if (!byManualId.has(String(manualId))) {
        byManualId.set(String(manualId), normalized);
      }
      if (ownerId) {
        const ownerKey = `${ownerId}:${manualId}`;
        if (!byManualOwnerKey.has(ownerKey)) {
          byManualOwnerKey.set(ownerKey, normalized);
        }
      }
    }
  });

  return { byItemId, byManualOwnerKey, byManualId };
}

function resolveManualCoverContext(lookup, { itemId = null, manualId = null, ownerId = null } = {}) {
  if (!lookup) return null;
  if (itemId) {
    const byItem = lookup.byItemId.get(String(itemId));
    if (byItem && (!ownerId || String(byItem.ownerId) === String(ownerId))) {
      return byItem;
    }
  }
  if (manualId && ownerId) {
    const byOwner = lookup.byManualOwnerKey.get(`${String(ownerId)}:${manualId}`);
    if (byOwner) return byOwner;
  }
  if (manualId) {
    return lookup.byManualId.get(String(manualId)) || null;
  }
  return null;
}

function shouldRedactOtherManualCover({ context, viewerId }) {
  if (!context) return false;
  if (String(context.shelfType || '').toLowerCase() !== OTHER_SHELF_TYPE) return false;
  if (context.ownerId && viewerId && String(context.ownerId) === String(viewerId)) return false;
  if (!context.ownerPhotoSource) return false;
  return !(context.ownerPhotoVisible && context.showPersonalPhotos);
}

function redactCoverMediaFields(target) {
  if (!target || typeof target !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(target, 'coverMediaPath')) target.coverMediaPath = null;
  if (Object.prototype.hasOwnProperty.call(target, 'coverMediaUrl')) target.coverMediaUrl = null;
  if (Object.prototype.hasOwnProperty.call(target, 'cover_media_path')) target.cover_media_path = null;
  if (Object.prototype.hasOwnProperty.call(target, 'cover_media_url')) target.cover_media_url = null;
}

function redactFeedItemOwnerPhotoPointers(item) {
  if (!item || typeof item !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(item, 'itemId')) item.itemId = null;
  if (item.payload && typeof item.payload === 'object') {
    if (Object.prototype.hasOwnProperty.call(item.payload, 'itemId')) item.payload.itemId = null;
    if (Object.prototype.hasOwnProperty.call(item.payload, 'item_id')) item.payload.item_id = null;
  }
}

function redactManualCoverInFeedItem(item) {
  if (!item || typeof item !== 'object') return;
  redactFeedItemOwnerPhotoPointers(item);
  redactCoverMediaFields(item);
  if (item.manual && typeof item.manual === 'object') {
    redactCoverMediaFields(item.manual);
  }
  if (item.collectable && typeof item.collectable === 'object') {
    const collectableIsManualFallback = !!(item.manualId || item.manual?.id || !item.collectable.id);
    if (collectableIsManualFallback) {
      redactCoverMediaFields(item.collectable);
    }
  }
}

function redactManualCoverInEntry(entry) {
  if (!entry || typeof entry !== 'object') return;
  redactCoverMediaFields(entry);
  if (entry.manual && typeof entry.manual === 'object') {
    redactCoverMediaFields(entry.manual);
  }
  if (entry.collectable && typeof entry.collectable === 'object') {
    const collectableIsManualFallback = !!(entry.manualId || entry.manual?.id || !entry.collectable.id);
    if (collectableIsManualFallback) {
      redactCoverMediaFields(entry.collectable);
    }
  }
}

async function applyManualCoverPrivacy(entries, viewerId) {
  if (!Array.isArray(entries) || !entries.length) return;

  const candidates = collectManualCoverCandidates(entries);
  if (!candidates.itemIds.length && !candidates.manualIds.length) return;

  const lookup = await loadManualCoverPrivacyLookup(candidates);

  entries.forEach((entry) => {
    const ownerId = entry?.owner?.id ? String(entry.owner.id) : null;
    if (!ownerId) return;

    if (Array.isArray(entry.items)) {
      entry.items.forEach((item) => {
        const manualId = parsePositiveInt(item?.manual?.id ?? item?.manualId);
        if (!manualId) return;
        const itemId = parsePositiveInt(item?.itemId ?? item?.id);
        const context = resolveManualCoverContext(lookup, { itemId, manualId, ownerId });
        if (!shouldRedactOtherManualCover({ context, viewerId })) return;
        redactManualCoverInFeedItem(item);
      });
    }

    const entryManualId = parsePositiveInt(entry?.manual?.id ?? entry?.manualId);
    if (!entryManualId) return;
    const entryContext = resolveManualCoverContext(lookup, {
      itemId: parsePositiveInt(entry?.itemId ?? null),
      manualId: entryManualId,
      ownerId,
    });
    if (!shouldRedactOtherManualCover({ context: entryContext, viewerId })) return;
    redactManualCoverInEntry(entry);
  });
}

function buildFeedItemsFromPayloads(payloads, eventType, limit) {
  if (!Array.isArray(payloads) || !eventType) return [];
  const maxItems = Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER;
  const items = [];
  const flattened = flattenPayloadItems(payloads);
  for (const payload of flattened) {
    if (!payload || typeof payload !== 'object') continue;

    // Handle aggregated item events (item.added, item.collectable_added, item.manual_added)
    if (eventType === 'item.collectable_added' || eventType === 'item.added') {
      // Check if this payload is a collectable (has collectableId or no manualId)
      const collectableId = payload.collectableId || payload.collectable_id || payload.collectable?.id || null;
      const coverUrl = getPayloadField(payload, ['coverUrl', 'cover_url']);
      const coverImageUrl = getPayloadField(payload, ['coverImageUrl', 'cover_image_url']);
      const coverImageSource = getPayloadField(payload, ['coverImageSource', 'cover_image_source']);
      const coverMediaPath = getPayloadField(payload, ['coverMediaPath', 'cover_media_path']);
      const coverMediaUrl = resolveCoverMediaUrl(
        coverMediaPath,
        getPayloadField(payload, ['coverMediaUrl', 'cover_media_url']),
      );
      const creator = payload.primaryCreator || payload.creator || payload.author || null;
      const year = payload.year ?? null;
      const isManual = payload.manualId || payload.manual_id || (!collectableId && (payload.name || payload.title));

      if (isManual) {
        // Treat as manual item
        const name = payload.name || payload.title || null;
        items.push({
          id: payload.itemId || payload.id || null,
          itemId: payload.itemId || payload.id || null,
          title: name,
          creator,
          year,
          manual: {
            id: payload.manualId || payload.manual_id || null,
            name,
            title: name,
            author: creator,
            year,
            coverMediaPath,
            coverMediaUrl,
            type: payload.type || payload.kind || null,
          },
        });
      } else {
        items.push({
          id: payload.itemId || payload.id || null,
          itemId: payload.itemId || payload.id || null,
          collectableId,
          title: payload.title || payload.name || null,
          creator,
          year,
          collectable: {
            id: collectableId,
            title: payload.title || payload.name || null,
            primaryCreator: creator,
            coverUrl,
            coverImageUrl,
            coverImageSource,
            coverMediaPath,
            coverMediaUrl,
            kind: payload.type || payload.kind || null,
            year,
          },
        });
      }
    } else if (eventType === 'item.manual_added') {
      const name = payload.name || payload.title || null;
      const creator = payload.author || payload.primaryCreator || payload.creator || null;
      const year = payload.year ?? null;
      const coverMediaPath = getPayloadField(payload, ['coverMediaPath', 'cover_media_path']);
      const coverMediaUrl = resolveCoverMediaUrl(
        coverMediaPath,
        getPayloadField(payload, ['coverMediaUrl', 'cover_media_url']),
      );
      items.push({
        id: payload.itemId || payload.id || null,
        itemId: payload.itemId || payload.id || null,
        title: name,
        creator,
        year,
        manual: {
          id: payload.manualId || payload.manual_id || null,
          name,
          title: name,
          author: creator,
          ageStatement: payload.ageStatement || null,
          year,
          specialMarkings: payload.specialMarkings || null,
          labelColor: payload.labelColor || null,
          regionalItem: payload.regionalItem || null,
          edition: payload.edition || null,
          description: payload.description || null,
          barcode: payload.barcode || null,
          limitedEdition: payload.limitedEdition || null,
          itemSpecificText: payload.itemSpecificText || null,
          coverMediaPath,
          coverMediaUrl,
          type: payload.type || payload.kind || null,
        },
      });
    } else if (eventType === 'item.rated') {
      // Rating events - include the rating value
      const collectableId = payload.collectableId || payload.collectable_id || null;
      const manualId = payload.manualId || payload.manual_id || null;
      const coverUrl = getPayloadField(payload, ['coverUrl', 'cover_url']);
      const coverImageUrl = getPayloadField(payload, ['coverImageUrl', 'cover_image_url']);
      const coverImageSource = getPayloadField(payload, ['coverImageSource', 'cover_image_source']);
      const coverMediaPath = getPayloadField(payload, ['coverMediaPath', 'cover_media_path']);
      const coverMediaUrl = resolveCoverMediaUrl(
        coverMediaPath,
        getPayloadField(payload, ['coverMediaUrl', 'cover_media_url']),
      );
      const item = {
        id: payload.itemId || payload.id || null,
        collectableId,
        rating: payload.rating ?? null,
        collectable: {
          id: collectableId,
          title: payload.title || payload.name || null,
          primaryCreator: payload.primaryCreator || payload.author || null,
          coverUrl,
          coverImageUrl,
          coverImageSource,
          coverMediaPath,
          coverMediaUrl,
          kind: payload.type || payload.kind || null,
        },
      };
      // For manual items, also include a manual object for frontend fallback
      if (manualId) {
        item.manualId = manualId;
        item.manual = {
          id: manualId,
          title: payload.title || payload.name || null,
          name: payload.title || payload.name || null,
          author: payload.primaryCreator || payload.author || null,
          coverMediaPath,
          coverMediaUrl,
        };
      }
      items.push(item);
    } else if (eventType === 'reviewed') {
      const collectableId = payload.collectableId || payload.collectable_id || null;
      const manualId = payload.manualId || payload.manual_id || null;
      const title = payload.title || payload.name || null;
      const coverUrl = getPayloadField(payload, ['coverUrl', 'cover_url']);
      const coverImageUrl = getPayloadField(payload, ['coverImageUrl', 'cover_image_url']);
      const coverImageSource = getPayloadField(payload, ['coverImageSource', 'cover_image_source']);
      const coverMediaPath = getPayloadField(payload, ['coverMediaPath', 'cover_media_path']);
      const coverMediaUrl = resolveCoverMediaUrl(
        coverMediaPath,
        getPayloadField(payload, ['coverMediaUrl', 'cover_media_url']),
      );
      const reviewItem = {
        id: payload.itemId || payload.id || null,
        collectableId,
        manualId,
        rating: payload.rating ?? null,
        notes: payload.notes || null,
        metadata: payload.metadata || null,
        reviewPublishedAt: payload.reviewPublishedAt || payload.review_published_at || null,
        reviewUpdatedAt: payload.reviewUpdatedAt || payload.review_updated_at || null,
        collectable: collectableId ? {
          id: collectableId,
          title,
          primaryCreator: payload.primaryCreator || payload.author || null,
          coverUrl,
          coverImageUrl,
          coverImageSource,
          coverMediaPath,
          coverMediaUrl,
          kind: payload.type || payload.kind || null,
        } : null,
      };
      if (manualId) {
        reviewItem.manual = {
          id: manualId,
          title,
          name: title,
          author: payload.primaryCreator || payload.author || null,
          coverMediaPath,
          coverMediaUrl,
          type: payload.type || payload.kind || 'manual',
        };
      }
      items.push(reviewItem);
    }
    if (items.length >= maxItems) break;
  }
  return items;
}

function mapFeedDetailItemRow(row, payload = null) {
  if (!row || typeof row !== 'object') return null;
  const resolvedTitle = row.collectable_title || row.manual_name || 'Unknown item';
  const resolvedCreator = row.collectable_primary_creator || row.primary_creator || row.manual_author || null;
  const resolvedYear = row.collectable_year ?? row.year ?? row.manual_year ?? null;
  const collectableCoverMediaPath = row.collectable_cover_media_path || row.cover_media_path || null;

  return {
    id: row.id,
    itemId: row.id,
    collectableId: row.collectable_id || null,
    manualId: row.manual_id || null,
    title: resolvedTitle,
    creator: resolvedCreator,
    year: resolvedYear,
    rating: payload?.rating ?? null,
    notes: payload?.notes || null,
    metadata: payload?.metadata || null,
    payload,
    collectable: row.collectable_id ? {
      id: row.collectable_id,
      title: resolvedTitle,
      primaryCreator: row.collectable_primary_creator || row.primary_creator || null,
      coverUrl: row.collectable_cover_url || row.cover_url || null,
      coverImageUrl: row.collectable_cover_image_url || row.cover_image_url || null,
      coverImageSource: row.collectable_cover_image_source || row.cover_image_source || null,
      coverMediaPath: collectableCoverMediaPath,
      coverMediaUrl: resolveMediaUrl(collectableCoverMediaPath),
      kind: row.collectable_kind || row.kind || null,
      year: row.collectable_year ?? row.year ?? null,
    } : null,
    manual: row.manual_id ? {
      id: row.manual_id,
      name: resolvedTitle,
      title: resolvedTitle,
      author: row.manual_author || null,
      description: row.manual_description || null,
      year: row.manual_year ?? null,
      ageStatement: row.manual_age_statement || null,
      specialMarkings: row.manual_special_markings || null,
      labelColor: row.manual_label_color || null,
      regionalItem: row.manual_regional_item || null,
      edition: row.manual_edition || null,
      barcode: row.manual_barcode || null,
      limitedEdition: row.limited_edition || null,
      itemSpecificText: row.item_specific_text || null,
      coverMediaPath: row.manual_cover_media_path || null,
      coverMediaUrl: resolveMediaUrl(row.manual_cover_media_path),
    } : null,
  };
}


function getPayloadItemCount(payloads) {
  if (!Array.isArray(payloads)) return null;
  let total = 0;
  let found = false;
  payloads.forEach((payload) => {
    if (!payload || typeof payload !== 'object') return;
    const count = Number(payload.itemCount);
    if (Number.isFinite(count) && count > 0) {
      total += Math.trunc(count);
      found = true;
      return;
    }
    if (Array.isArray(payload.items)) {
      total += payload.items.length;
      found = true;
    }
  });
  return found ? total : null;
}

function extractItemIdsFromPayloads(payloads) {
  if (!Array.isArray(payloads)) return [];
  const ids = [];
  payloads.forEach((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.itemIds)) {
      payload.itemIds.forEach((id) => {
        const parsed = parseInt(id, 10);
        if (Number.isFinite(parsed)) ids.push(parsed);
      });
      return;
    }
    const parsed = parseInt(payload.itemId, 10);
    if (Number.isFinite(parsed)) ids.push(parsed);
  });
  return ids;
}

async function summarizeItems(shelfIds) {
  if (!shelfIds.length) return new Map();

  const result = await query(
    `SELECT uc.shelf_id,
            uc.id, uc.collectable_id, uc.manual_id, uc.position, uc.notes, uc.rating,
            c.title as collectable_title, c.primary_creator, c.cover_url, c.cover_media_id, c.kind,
            m.local_path as cover_media_path,
            um.name as manual_name, um.author as manual_author, um.limited_edition, um.item_specific_text,
            um.cover_media_path as manual_cover_media_path
     FROM user_collections uc
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
     LEFT JOIN media m ON m.id = c.cover_media_id
     WHERE uc.shelf_id = ANY($1)
     ORDER BY uc.created_at DESC`,
    [shelfIds]
  );

  const map = new Map();
  for (const row of result.rows) {
    const key = String(row.shelf_id);
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key);
    if (arr.length < 5) {
      arr.push({
        id: row.id,
        collectable: row.collectable_id ? {
          id: row.collectable_id,
          title: row.collectable_title,
          primaryCreator: row.primary_creator,
          coverUrl: row.cover_url,
          coverMediaId: row.cover_media_id,
          coverMediaPath: row.cover_media_path,
          coverMediaUrl: resolveMediaUrl(row.cover_media_path),
          kind: row.kind,
        } : null,
        manual: row.manual_id ? {
          id: row.manual_id,
          name: row.manual_name,
          author: row.manual_author,
          limitedEdition: row.limited_edition,
          itemSpecificText: row.item_specific_text,
          coverMediaPath: row.manual_cover_media_path || null,
          coverMediaUrl: resolveMediaUrl(row.manual_cover_media_path),
        } : null,
        position: row.position,
        notes: row.notes,
        rating: row.rating,
      });
    }
  }
  return map;
}

async function getShelfCounts(shelfIds) {
  if (!shelfIds.length) return new Map();

  const result = await query(
    `SELECT shelf_id, COUNT(*) as total
     FROM user_collections
     WHERE shelf_id = ANY($1)
     GROUP BY shelf_id`,
    [shelfIds]
  );

  return new Map(result.rows.map(r => [String(r.shelf_id), parseInt(r.total)]));
}

const CHECKIN_RATING_MERGE_WINDOW_MINUTES = parseInt(
  process.env.CHECKIN_RATING_MERGE_WINDOW_MINUTES || '30',
  10
);
const REVIEW_RATING_MERGE_WINDOW_MINUTES = parseInt(
  process.env.REVIEW_RATING_MERGE_WINDOW_MINUTES || '120',
  10,
);
const ADDED_RATING_MERGE_WINDOW_MINUTES = parseInt(
  process.env.ADDED_RATING_MERGE_WINDOW_MINUTES || '30',
  10,
);

function getFeedItemIdentity(item = {}) {
  const collectableId = item.collectableId || item.collectable?.id || null;
  const manualId = item.manualId || item.manual?.id || null;
  const title = String(
    item.collectable?.title || item.manual?.title || item.title || ''
  ).toLowerCase().trim();

  return {
    collectableId: collectableId ? String(collectableId) : null,
    manualId: manualId ? String(manualId) : null,
    title,
  };
}

function feedItemsMatch(a, b) {
  const left = getFeedItemIdentity(a);
  const right = getFeedItemIdentity(b);

  if (left.collectableId && right.collectableId && left.collectableId === right.collectableId) {
    return true;
  }
  if (left.manualId && right.manualId && left.manualId === right.manualId) {
    return true;
  }
  if (left.title && right.title && left.title === right.title) {
    return true;
  }
  return false;
}

function getFeedItemId(item = {}) {
  const itemId = item.itemId ?? item.id ?? null;
  if (itemId === null || itemId === undefined || itemId === '') return null;
  return String(itemId);
}

function getEntryActivityTime(entry = {}) {
  const candidate = entry.updatedAt || entry.createdAt;
  const timestamp = new Date(candidate).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Merges check-in events with matching rating events into combined 'checkin.rated' entries.
 * Matching criteria: same user, same item (by collectableId, manualId, or title), within time window.
 */
function mergeCheckinRatingPairs(entries, options = {}) {
  const { windowMinutes = CHECKIN_RATING_MERGE_WINDOW_MINUTES } = options;
  const windowMs = windowMinutes * 60 * 1000;

  // Separate check-ins and rating events
  const checkins = [];
  const ratings = [];
  const others = [];

  for (const entry of entries) {
    if (entry.eventType === 'checkin.activity') {
      checkins.push(entry);
    } else if (entry.eventType === 'item.rated') {
      ratings.push(entry);
    } else {
      others.push(entry);
    }
  }

  // Track which rating items have been merged
  const mergedRatingItems = new Map(); // Map<ratingEntryId, Set<itemIndex>>
  const consumedRatingItems = new Set(); // Set<`${ratingEntryId}:${itemIndex}`>
  const checkinsByRecency = [...checkins].sort((a, b) => (
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ));
  const mergedCheckinById = new Map(checkins.map((checkin) => [checkin.id, checkin]));

  // Process each check-in to find matching ratings (most recent check-in wins)
  for (const checkin of checkinsByRecency) {
    const checkinUserId = String(checkin.owner?.id || '');
    const checkinTime = new Date(checkin.createdAt).getTime();
    const checkinCollectableId = checkin.collectable?.id || null;
    const checkinManualId = checkin.manual?.id || null;
    const checkinTitle = (checkin.collectable?.title || checkin.manual?.title || '').toLowerCase().trim();

    // Find matching rating from same user within time window
    for (const rating of ratings) {
      const ratingUserId = String(rating.owner?.id || '');
      if (ratingUserId !== checkinUserId) continue;

      const ratingTime = new Date(rating.createdAt).getTime();
      const timeDiff = Math.abs(ratingTime - checkinTime);
      if (timeDiff > windowMs) continue;

      // Check each item in the rating for a match
      const ratingItems = rating.items || [];
      for (let i = 0; i < ratingItems.length; i++) {
        const consumedKey = `${rating.id}:${i}`;
        if (consumedRatingItems.has(consumedKey)) continue;

        const ratingItem = ratingItems[i];
        const ratingCollectableId = ratingItem.collectableId || ratingItem.collectable?.id || null;
        const ratingManualId = ratingItem.manualId || ratingItem.manual?.id || null;
        const ratingTitle = (
          ratingItem.collectable?.title ||
          ratingItem.manual?.title ||
          ratingItem.title ||
          ''
        ).toLowerCase().trim();

        // Match by collectableId, manualId, or title
        const matchByCollectable = checkinCollectableId && ratingCollectableId &&
          String(checkinCollectableId) === String(ratingCollectableId);
        const matchByManual = checkinManualId && ratingManualId &&
          String(checkinManualId) === String(ratingManualId);
        const matchByTitle = checkinTitle && ratingTitle && checkinTitle === ratingTitle;

        if (matchByCollectable || matchByManual || matchByTitle) {
          // Found a match - create merged entry
          const mergedEntry = {
            ...checkin,
            eventType: 'checkin.rated',
            rating: ratingItem.rating,
            ratingEventId: rating.id,
            displayHints: getDisplayHints('checkin.rated'),
          };

          // Track this rating item as merged
          if (!mergedRatingItems.has(rating.id)) {
            mergedRatingItems.set(rating.id, new Set());
          }
          mergedRatingItems.get(rating.id).add(i);
          consumedRatingItems.add(consumedKey);
          mergedCheckinById.set(checkin.id, mergedEntry);
          break;
        }
      }
      if (mergedCheckinById.get(checkin.id)?.eventType === 'checkin.rated') break;
    }
  }
  const mergedCheckins = checkins.map((checkin) => mergedCheckinById.get(checkin.id) || checkin);

  // Process ratings - remove merged items or entire entries
  const processedRatings = [];
  for (const rating of ratings) {
    const mergedIndices = mergedRatingItems.get(rating.id);
    if (!mergedIndices) {
      // No items were merged, keep as-is
      processedRatings.push(rating);
      continue;
    }

    // Filter out merged items
    const remainingItems = (rating.items || []).filter((_, idx) => !mergedIndices.has(idx));

    if (remainingItems.length === 0) {
      // All items were merged, remove entire entry
      continue;
    }

    // Update entry with remaining items
    processedRatings.push({
      ...rating,
      items: remainingItems,
      eventItemCount: remainingItems.length,
    });
  }

  // Combine all entries back together and sort by latest activity time
  const allEntries = [...mergedCheckins, ...processedRatings, ...others];
  allEntries.sort((a, b) => {
    const timeA = getEntryActivityTime(a);
    const timeB = getEntryActivityTime(b);
    return timeB - timeA; // Descending (newest first)
  });

  return allEntries;
}

/**
 * Merges reviewed + rating events into a single reviewed event when:
 * - same user
 * - same item (prefer exact itemId; fallback to collectable/manual identity)
 * - events occur within time window (either ordering)
 *
 * Result:
 * - standalone rating entries are omitted when paired to a reviewed entry
 * - reviewed entry rating is updated from the paired rating when available
 */
function mergeReviewedRatingPairs(entries, options = {}) {
  const { windowMinutes = REVIEW_RATING_MERGE_WINDOW_MINUTES } = options;
  const windowMs = windowMinutes * 60 * 1000;

  const reviewedEntries = [];
  const ratingEntries = [];
  const others = [];

  for (const entry of entries) {
    if (entry.eventType === 'reviewed') {
      reviewedEntries.push(entry);
    } else if (entry.eventType === 'item.rated') {
      ratingEntries.push(entry);
    } else {
      others.push(entry);
    }
  }

  if (!reviewedEntries.length || !ratingEntries.length) {
    return entries;
  }

  const ratingsByTime = [...ratingEntries].sort((a, b) => (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ));

  const consumedRatingItems = new Set(); // `${ratingEntryId}:${itemIndex}`
  const mergedReviewed = reviewedEntries.map((entry) => ({
    ...entry,
    items: Array.isArray(entry.items) ? entry.items.map((item) => ({ ...item })) : [],
  }));

  for (const reviewed of mergedReviewed) {
    const reviewedUserId = String(reviewed.owner?.id || '');
    const reviewedTime = new Date(reviewed.createdAt).getTime();
    if (!Number.isFinite(reviewedTime)) continue;

    let mergedTimestamp = reviewedTime;

    const reviewedItems = Array.isArray(reviewed.items) ? reviewed.items : [];
    for (let i = 0; i < reviewedItems.length; i++) {
      const reviewedItem = reviewedItems[i];
      const reviewedItemId = getFeedItemId(reviewedItem);
      let found = null;

      for (const ratingEntry of ratingsByTime) {
        const ratingUserId = String(ratingEntry.owner?.id || '');
        if (ratingUserId !== reviewedUserId) continue;

        const ratingTime = new Date(ratingEntry.createdAt).getTime();
        if (!Number.isFinite(ratingTime)) continue;
        const absDiff = Math.abs(ratingTime - reviewedTime);
        if (absDiff > windowMs) continue;

        const ratingItems = Array.isArray(ratingEntry.items) ? ratingEntry.items : [];
        for (let rIdx = 0; rIdx < ratingItems.length; rIdx++) {
          const consumedKey = `${ratingEntry.id}:${rIdx}`;
          if (consumedRatingItems.has(consumedKey)) continue;

          const ratingItem = ratingItems[rIdx];
          const ratingItemId = getFeedItemId(ratingItem);
          const bothHaveItemId = !!(reviewedItemId && ratingItemId);
          const matchesByItemId = bothHaveItemId && ratingItemId === reviewedItemId;
          const matchesByIdentity = !bothHaveItemId && feedItemsMatch(reviewedItem, ratingItem);
          if (!matchesByItemId && !matchesByIdentity) continue;

          const candidate = {
            ratingEntry,
            ratingItem,
            ratingItemIndex: rIdx,
            ratingTime,
            isAfterReview: ratingTime >= reviewedTime,
          };

          if (!found) {
            found = candidate;
            continue;
          }

          // Prefer ratings after the review. Within the same direction, prefer the latest rating.
          if (candidate.isAfterReview && !found.isAfterReview) {
            found = candidate;
            continue;
          }
          if (candidate.isAfterReview === found.isAfterReview && candidate.ratingTime > found.ratingTime) {
            found = candidate;
          }
        }
      }

      if (!found) continue;

      const resolvedRating = found.ratingItem?.rating;
      if (resolvedRating !== undefined && resolvedRating !== null) {
        reviewedItems[i] = {
          ...reviewedItem,
          rating: resolvedRating,
        };
      }

      consumedRatingItems.add(`${found.ratingEntry.id}:${found.ratingItemIndex}`);
      if (found.ratingTime > mergedTimestamp) {
        mergedTimestamp = found.ratingTime;
      }
    }

    if (mergedTimestamp > reviewedTime) {
      const mergedIso = new Date(mergedTimestamp).toISOString();
      reviewed.createdAt = mergedIso;
      reviewed.updatedAt = mergedIso;
    }
  }

  const remainingRatings = [];
  for (const rating of ratingEntries) {
    const ratingItems = Array.isArray(rating.items) ? rating.items : [];
    const nextItems = ratingItems.filter((_, idx) => !consumedRatingItems.has(`${rating.id}:${idx}`));
    if (!nextItems.length) continue;

    remainingRatings.push({
      ...rating,
      items: nextItems,
      eventItemCount: nextItems.length,
    });
  }

  const combined = [...mergedReviewed, ...remainingRatings, ...others];
  combined.sort((a, b) => (
    getEntryActivityTime(b) - getEntryActivityTime(a)
  ));
  return combined;
}

/**
 * Merges item.added + rating events so that a separate "rated" card is absorbed
 * into the "added" card when both refer to the same item from the same user
 * within the configured time window.
 */
function mergeAddedRatingPairs(entries, options = {}) {
  const { windowMinutes = ADDED_RATING_MERGE_WINDOW_MINUTES } = options;
  const windowMs = windowMinutes * 60 * 1000;

  const addedEntries = [];
  const ratingEntries = [];
  const others = [];

  for (const entry of entries) {
    if (entry.eventType === 'item.added') {
      addedEntries.push(entry);
    } else if (entry.eventType === 'item.rated') {
      ratingEntries.push(entry);
    } else {
      others.push(entry);
    }
  }

  if (!addedEntries.length || !ratingEntries.length) {
    return entries;
  }

  const ratingsByTime = [...ratingEntries].sort((a, b) => (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ));

  const consumedRatingItems = new Set(); // `${ratingEntryId}:${itemIndex}`
  const mergedAdded = addedEntries.map((entry) => ({
    ...entry,
    items: Array.isArray(entry.items) ? entry.items.map((item) => ({ ...item })) : [],
  }));

  for (const added of mergedAdded) {
    const addedUserId = String(added.owner?.id || '');
    const addedTime = new Date(added.createdAt).getTime();
    if (!Number.isFinite(addedTime)) continue;

    const addedItems = Array.isArray(added.items) ? added.items : [];
    for (let i = 0; i < addedItems.length; i++) {
      const addedItem = addedItems[i];
      const addedItemId = getFeedItemId(addedItem);
      let found = null;

      for (const ratingEntry of ratingsByTime) {
        const ratingUserId = String(ratingEntry.owner?.id || '');
        if (ratingUserId !== addedUserId) continue;

        const ratingTime = new Date(ratingEntry.createdAt).getTime();
        if (!Number.isFinite(ratingTime)) continue;
        const absDiff = Math.abs(ratingTime - addedTime);
        if (absDiff > windowMs) continue;

        const ratingItems = Array.isArray(ratingEntry.items) ? ratingEntry.items : [];
        for (let rIdx = 0; rIdx < ratingItems.length; rIdx++) {
          const consumedKey = `${ratingEntry.id}:${rIdx}`;
          if (consumedRatingItems.has(consumedKey)) continue;

          const ratingItem = ratingItems[rIdx];
          const ratingItemId = getFeedItemId(ratingItem);
          const bothHaveItemId = !!(addedItemId && ratingItemId);
          const matchesByItemId = bothHaveItemId && ratingItemId === addedItemId;
          const matchesByIdentity = !bothHaveItemId && feedItemsMatch(addedItem, ratingItem);
          if (!matchesByItemId && !matchesByIdentity) continue;

          const candidate = {
            ratingEntry,
            ratingItem,
            ratingItemIndex: rIdx,
            ratingTime,
            isAfterAdded: ratingTime >= addedTime,
          };

          if (!found) {
            found = candidate;
            continue;
          }

          // Prefer ratings after the add. Within same direction, prefer latest.
          if (candidate.isAfterAdded && !found.isAfterAdded) {
            found = candidate;
            continue;
          }
          if (candidate.isAfterAdded === found.isAfterAdded && candidate.ratingTime > found.ratingTime) {
            found = candidate;
          }
        }
      }

      if (!found) continue;

      const resolvedRating = found.ratingItem?.rating;
      if (resolvedRating !== undefined && resolvedRating !== null) {
        addedItems[i] = {
          ...addedItem,
          rating: resolvedRating,
        };
      }

      consumedRatingItems.add(`${found.ratingEntry.id}:${found.ratingItemIndex}`);
    }
  }

  const remainingRatings = [];
  for (const rating of ratingEntries) {
    const ratingItems = Array.isArray(rating.items) ? rating.items : [];
    const nextItems = ratingItems.filter((_, idx) => !consumedRatingItems.has(`${rating.id}:${idx}`));
    if (!nextItems.length) continue;

    remainingRatings.push({
      ...rating,
      items: nextItems,
      eventItemCount: nextItems.length,
    });
  }

  const combined = [...mergedAdded, ...remainingRatings, ...others];
  combined.sort((a, b) => (
    getEntryActivityTime(b) - getEntryActivityTime(a)
  ));
  return combined;
}

async function getFeed(req, res) {
  try {
    const scope = String(req.query.scope || 'global').toLowerCase();
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
    const typeFilter = req.query.type ? String(req.query.type).trim() : null;
    const ownerOverride = req.query.ownerId ? String(req.query.ownerId).trim() : null;
    const refreshPersonalizations = req.query.refreshPersonalizations === '1';

    const viewerId = req.user.id;

    let events = [];

    if (ownerOverride) {
      // Security: Verify viewer has permission to see this user's feed
      if (ownerOverride !== viewerId) {
        const canAccess = await ensureUsersNotBlocked({
          res,
          viewerId,
          targetUserId: ownerOverride,
          error: 'You do not have permission to view this feed',
        });
        if (!canAccess) return;

        const isFriend = await friendshipQueries.areFriends(viewerId, ownerOverride);
        if (!isFriend) {
          return res.status(403).json({ error: 'You do not have permission to view this feed' });
        }
      }
      events = await feedQueries.getMyFeed(ownerOverride, { limit, offset, type: typeFilter });
    } else if (scope === 'friends') {
      events = await feedQueries.getFriendsFeed(viewerId, { limit, offset, type: typeFilter });
    } else if (scope === 'mine') {
      events = await feedQueries.getMyFeed(viewerId, { limit, offset, type: typeFilter });
    } else if (scope === 'all') {
      events = await feedQueries.getAllFeed(viewerId, { limit, offset, type: typeFilter });
    } else {
      events = await feedQueries.getGlobalFeed(viewerId, { limit, offset, type: typeFilter });
    }

    if (!events.length) {
      let entries = [];
      if (scope === 'all' && offset === 0 && (!typeFilter || typeFilter === 'news.recommendation')) {
        try {
          const groups = await getNewsRecommendationsForUser(viewerId, {
            groupLimit: NEWS_FEED_GROUP_LIMIT,
            itemsPerGroup: NEWS_FEED_ITEMS_PER_GROUP,
            forceRandomize: refreshPersonalizations,
          });
          entries = buildNewsRecommendationEntries(groups);
          await markNewsEntriesSeen(viewerId, entries);
        } catch (newsErr) {
          logger.warn('[Feed] Failed to build news recommendations:', newsErr.message);
        }
      }
      return res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries });
    }

    // Get shelf counts
    const shelfIds = [...new Set(events.map(e => e.shelfId).filter(Boolean))];
    const countMap = await getShelfCounts(shelfIds);
    const aggregateIds = [...new Set(events.map(e => e.id).filter(Boolean))];
    const socialMap = await eventSocialQueries.getSocialSummaries(aggregateIds, viewerId);

    let entries = events.map(e => {
      const social = socialMap.get(e.id) || {};
      const isCheckIn = e.eventType === 'checkin.activity';

      // Base entry properties
      const entry = {
        id: e.id,
        aggregateId: e.id,
        eventType: e.eventType,
        createdAt: e.createdAt,
        updatedAt: e.lastActivityAt || e.createdAt,
        likeCount: social.likeCount || 0,
        commentCount: social.commentCount || 0,
        hasLiked: !!social.hasLiked,
        topComment: social.topComment || null,
        owner: {
          id: e.userId,
          username: e.username,
          name: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || undefined,
          city: e.city,
          state: e.state,
          country: e.country,
          picture: e.userPicture,
          profileMediaPath: e.profileMediaPath,
          profileMediaUrl: resolveMediaUrl(e.profileMediaPath),
        },
      };

      if (isCheckIn) {
        // Check-in event: include collectable info and check-in specific fields
        entry.checkinStatus = e.checkinStatus;
        entry.visibility = e.visibility;
        entry.note = e.note;
        const manual = e.manualId ? {
          id: e.manualId,
          title: e.manualName,
          primaryCreator: e.manualAuthor,
          coverUrl: null,
          coverMediaPath: e.manualCoverMediaPath || null,
          coverMediaUrl: resolveMediaUrl(e.manualCoverMediaPath),
          kind: e.manualType || 'manual',
        } : null;
        const collectable = e.collectableId ? {
          id: e.collectableId,
          title: e.collectableTitle,
          primaryCreator: e.collectableCreator,
          coverUrl: e.collectableCoverUrl,
          coverImageUrl: e.collectableCoverImageUrl,
          coverImageSource: e.collectableCoverImageSource,
          coverMediaPath: e.collectableCoverMediaPath,
          coverMediaUrl: resolveMediaUrl(e.collectableCoverMediaPath),
          kind: e.collectableKind,
        } : null;
        entry.collectable = collectable || manual;
        if (manual) {
          entry.manual = manual;
        }
      } else {
        // Shelf-based event: include shelf and items info
        const payloads = Array.isArray(e.previewPayloads) ? e.previewPayloads : [];
        const feedItems = buildFeedItemsFromPayloads(payloads, e.eventType, PREVIEW_PAYLOAD_LIMIT);
        const payloadItemCount = getPayloadItemCount(payloads);
        const counts = [e.itemCount, payloadItemCount].filter((value) => Number.isFinite(value) && value > 0);
        const eventItemCount = counts.length ? Math.max(...counts) : feedItems.length;

        entry.eventItemCount = eventItemCount || 0;
        entry.shelf = {
          id: e.shelfId,
          name: e.shelfName,
          type: e.shelfType,
          description: e.shelfDescription,
          visibility: 'public',
          createdAt: e.createdAt,
          updatedAt: e.lastActivityAt || e.createdAt,
          itemCount: countMap.get(String(e.shelfId)) || 0,
        };
        entry.items = feedItems;
      }

      entry.displayHints = getDisplayHints(e.eventType);
      return entry;
    });

    // Merge check-in + rating pairs into combined entries
    entries = mergeCheckinRatingPairs(entries);
    // Merge reviewed + rating pairs into a single reviewed entry
    entries = mergeReviewedRatingPairs(entries);
    // Merge added + rating pairs so rating appears on the added card
    entries = mergeAddedRatingPairs(entries);

    if (scope === 'all' && offset === 0 && (!typeFilter || typeFilter === 'news.recommendation')) {
      try {
        const groups = await getNewsRecommendationsForUser(viewerId, {
          groupLimit: NEWS_FEED_GROUP_LIMIT,
          itemsPerGroup: NEWS_FEED_ITEMS_PER_GROUP,
          forceRandomize: refreshPersonalizations,
        });
        const newsEntries = buildNewsRecommendationEntries(groups);
        if (newsEntries.length) {
          entries = interleaveEntries(entries, newsEntries, NEWS_FEED_INSERT_INTERVAL).slice(0, limit);
          await markNewsEntriesSeen(viewerId, entries);
        }
      } catch (newsErr) {
        logger.warn('[Feed] Failed to build news recommendations:', newsErr.message);
      }
    }

    await applyManualCoverPrivacy(entries, viewerId);
    res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries });
  } catch (err) {
    logger.error('getFeed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getFeedEntryDetails(req, res) {
  try {
    const rawId = String(req.params.shelfId || '').trim();
    // STRICT check: valid if it contains only digits.
    // parseInt("12abc") returns 12, which causes UUIDs starting with digits to be treated as Shelf IDs.
    const isNumeric = /^\d+$/.test(rawId);
    const shelfId = isNumeric ? parseInt(rawId, 10) : null;
    const aggregateId = isNumeric ? null : rawId;

    const viewerId = req.user.id;
    if (!isNumeric && !aggregateId) return res.status(400).json({ error: 'Invalid feed entry id' });

    if (!isNumeric) {
      const aggregateResult = await query(
        `SELECT a.*, 
                u.username, u.first_name, u.last_name, u.picture, u.city, u.state, u.country,
                pm.local_path as profile_media_path,
                s.id as shelf_id, s.owner_id as shelf_owner_id,
                s.name as shelf_name, s.type as shelf_type, s.description as shelf_description, s.visibility as shelf_visibility,
                c.title as collectable_title, c.primary_creator as collectable_creator,
                c.cover_url as collectable_cover_url,
                c.cover_image_url as collectable_cover_image_url,
                c.cover_image_source as collectable_cover_image_source,
                c.kind as collectable_kind,
                cm.local_path as collectable_cover_media_path,
                um.name as manual_name, um.author as manual_author, um.type as manual_type
         FROM event_aggregates a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
         LEFT JOIN shelves s ON s.id = a.shelf_id
         LEFT JOIN collectables c ON c.id = a.collectable_id
         LEFT JOIN media cm ON cm.id = c.cover_media_id
         LEFT JOIN user_manuals um ON um.id = a.manual_id
         WHERE a.id = $1`,
        [aggregateId]
      );

      if (!aggregateResult.rows.length) return res.status(404).json({ error: 'Feed entry not found' });

      const aggregate = rowToCamelCase(aggregateResult.rows[0]);
      const isCheckIn = aggregate.eventType === 'checkin.activity';
      const isOwner = !!(viewerId && aggregate.userId && String(viewerId) === String(aggregate.userId));

      if (!isOwner) {
        const canAccess = await ensureUsersNotBlocked({
          res,
          viewerId,
          targetUserId: aggregate.userId,
          error: 'You do not have access to this feed entry',
        });
        if (!canAccess) return;
      }

      if (isCheckIn && !isOwner) {
        const visibility = aggregate.visibility || 'public';
        if (visibility === 'friends') {
          const isFriend = await friendshipQueries.areFriends(viewerId, aggregate.userId);
          if (!isFriend) {
            return res.status(403).json({ error: 'Viewer does not have access' });
          }
        } else if (visibility !== 'public') {
          return res.status(403).json({ error: 'Viewer does not have access' });
        }
      }

      const resolvedShelfId = aggregate.shelfId;
      let shelf = null;
      if (!isCheckIn && resolvedShelfId) {
        shelf = await shelvesQueries.getForViewing(resolvedShelfId, viewerId);
        if (!shelf) return res.status(404).json({ error: 'Feed entry not found' });
      }

      let items = [];
      let payloadItemCount = null;
      if (!isCheckIn) {
        const logsResult = await query(
          `SELECT e.id, e.event_type, e.payload, e.created_at
           FROM event_logs e
           WHERE e.aggregate_id = $1
           ORDER BY e.created_at ASC`,
          [aggregateId]
        );

        const payloads = logsResult.rows.map((row) => row.payload || {});
        payloadItemCount = getPayloadItemCount(payloads);
        const itemIds = extractItemIdsFromPayloads(payloads);
        const payloadByItemId = new Map();
        const flattenedPayloadItems = flattenPayloadItems(payloads);
        flattenedPayloadItems.forEach((payloadItem) => {
          if (!payloadItem || typeof payloadItem !== 'object') return;
          const payloadItemId = payloadItem.itemId || payloadItem.id;
          if (payloadItemId == null) return;
          payloadByItemId.set(String(payloadItemId), payloadItem);
        });

        if (itemIds.length) {
          const itemsResult = await query(
            `SELECT uc.id, uc.collectable_id, uc.manual_id,
                    c.title as collectable_title,
                    c.primary_creator as collectable_primary_creator,
                    c.cover_url as collectable_cover_url,
                    c.cover_image_url as collectable_cover_image_url,
                    c.cover_image_source as collectable_cover_image_source,
                    c.kind as collectable_kind,
                    c.year as collectable_year,
                    m.local_path as collectable_cover_media_path,
                    um.name as manual_name,
                    um.author as manual_author,
                    um.description as manual_description,
                    um.year as manual_year,
                    um.age_statement as manual_age_statement,
                    um.special_markings as manual_special_markings,
                    um.label_color as manual_label_color,
                    um.regional_item as manual_regional_item,
                    um.edition as manual_edition,
                    um.regional_item as manual_regional_item,
                    um.edition as manual_edition,
                    um.barcode as manual_barcode,
                    um.limited_edition,
                    um.item_specific_text,
                    um.cover_media_path as manual_cover_media_path
             FROM user_collections uc
             LEFT JOIN collectables c ON c.id = uc.collectable_id
             LEFT JOIN user_manuals um ON um.id = uc.manual_id
             LEFT JOIN media m ON m.id = c.cover_media_id
             WHERE uc.id = ANY($1)
             ORDER BY array_position($1, uc.id)`,
            [itemIds]
          );

          items = itemsResult.rows
            .map((row) => mapFeedDetailItemRow(row, payloadByItemId.get(String(row.id)) || null))
            .filter(Boolean);

          if (!items.length) {
            items = buildFeedItemsFromPayloads(payloads, aggregate.eventType);
          }
        } else {
          items = buildFeedItemsFromPayloads(payloads, aggregate.eventType);
        }
      }

      const entry = {
        id: aggregate.id,
        aggregateId: aggregate.id,
        eventType: aggregate.eventType,
        createdAt: aggregate.createdAt,
        updatedAt: aggregate.lastActivityAt || aggregate.createdAt,
        likeCount: 0,
        commentCount: 0,
        hasLiked: false,
        owner: {
          id: aggregate.userId,
          username: aggregate.username,
          name: [aggregate.firstName, aggregate.lastName].filter(Boolean).join(' ').trim() || undefined,
          city: aggregate.city,
          state: aggregate.state,
          country: aggregate.country,
          picture: aggregate.picture,
          profileMediaPath: aggregate.profileMediaPath,
          profileMediaUrl: resolveMediaUrl(aggregate.profileMediaPath),
        },
      };

      if (isCheckIn) {
        entry.checkinStatus = aggregate.checkinStatus;
        entry.visibility = aggregate.visibility;
        entry.note = aggregate.note;
        const manual = aggregate.manualId ? {
          id: aggregate.manualId,
          title: aggregate.manualName,
          primaryCreator: aggregate.manualAuthor,
          coverUrl: null,
          coverMediaPath: aggregate.manualCoverMediaPath || null,
          coverMediaUrl: resolveMediaUrl(aggregate.manualCoverMediaPath),
          kind: aggregate.manualType || 'manual',
        } : null;
        const collectable = aggregate.collectableId ? {
          id: aggregate.collectableId,
          title: aggregate.collectableTitle,
          primaryCreator: aggregate.collectableCreator,
          coverUrl: aggregate.collectableCoverUrl,
          coverImageUrl: aggregate.collectableCoverImageUrl,
          coverImageSource: aggregate.collectableCoverImageSource,
          coverMediaPath: aggregate.collectableCoverMediaPath,
          coverMediaUrl: resolveMediaUrl(aggregate.collectableCoverMediaPath),
          kind: aggregate.collectableKind,
        } : null;
        entry.collectable = collectable || manual;
        if (manual) {
          entry.manual = manual;
        }
      } else {
        entry.itemCount = Math.max(
          Number.isFinite(payloadItemCount) ? payloadItemCount : 0,
          Number.isFinite(aggregate.itemCount) ? aggregate.itemCount : 0,
          items.length
        );
        entry.shelf = shelf ? {
          id: shelf.id,
          name: shelf.name,
          type: shelf.type,
          description: shelf.description,
          visibility: shelf.visibility,
          createdAt: shelf.createdAt,
          updatedAt: shelf.updatedAt,
          itemCount: items.length,
        } : {
          id: aggregate.shelfId,
          name: aggregate.shelfName,
          type: aggregate.shelfType,
          description: aggregate.shelfDescription,
          visibility: aggregate.shelfVisibility,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.lastActivityAt || aggregate.createdAt,
          itemCount: items.length,
        };
        entry.items = items;
      }

      const socialMap = await eventSocialQueries.getSocialSummaries([aggregate.id], viewerId);
      const social = socialMap.get(aggregate.id) || {};
      entry.likeCount = social.likeCount || 0;
      entry.commentCount = social.commentCount || 0;
      entry.hasLiked = !!social.hasLiked;
      entry.topComment = social.topComment || null;

      entry.displayHints = getDisplayHints(aggregate.eventType);
      await applyManualCoverPrivacy([entry], viewerId);
      return res.json({ entry });
    }

    const shelfOwnerId = await shelvesQueries.getOwnerIdForShelf(shelfId);
    if (shelfOwnerId && String(shelfOwnerId) !== String(viewerId)) {
      const canAccess = await ensureUsersNotBlocked({
        res,
        viewerId,
        targetUserId: shelfOwnerId,
        error: 'You do not have access to this feed entry',
      });
      if (!canAccess) return;
    }

    const shelf = await shelvesQueries.getForViewing(shelfId, viewerId);
    if (!shelf) return res.status(404).json({ error: 'Feed entry not found' });

    // Get owner info
    const ownerResult = await query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.picture, u.city, u.state, u.country,
              pm.local_path as profile_media_path
       FROM users u
       LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
       WHERE u.id = $1`,
      [shelf.ownerId]
    );
    const owner = ownerResult.rows[0];

    // Get all items
    const itemsResult = await query(
      `SELECT uc.*, 
              c.title as collectable_title, c.primary_creator, c.cover_url, c.cover_media_id, c.kind,
              m.local_path as cover_media_path,
              c.description as collectable_description, c.year, c.tags,
              um.name as manual_name, um.author as manual_author, um.description as manual_description,
              um.year as manual_year,
              um.age_statement as manual_age_statement,
              um.special_markings as manual_special_markings,
              um.label_color as manual_label_color,
              um.regional_item as manual_regional_item,
              um.edition as manual_edition,
              um.regional_item as manual_regional_item,
              um.edition as manual_edition,
              um.barcode as manual_barcode,
              um.limited_edition,
              um.item_specific_text,
              um.cover_media_path as manual_cover_media_path
       FROM user_collections uc
       LEFT JOIN collectables c ON c.id = uc.collectable_id
       LEFT JOIN user_manuals um ON um.id = uc.manual_id
       LEFT JOIN media m ON m.id = c.cover_media_id
       WHERE uc.shelf_id = $1
       ORDER BY uc.created_at DESC`,
      [shelfId]
    );

    const entry = {
      shelf: {
        id: shelf.id,
        name: shelf.name,
        type: shelf.type,
        description: shelf.description,
        visibility: shelf.visibility,
        createdAt: shelf.createdAt,
        updatedAt: shelf.updatedAt,
        itemCount: itemsResult.rows.length,
      },
      owner: {
        id: owner.id,
        username: owner.username,
        name: [owner.first_name, owner.last_name].filter(Boolean).join(' ').trim() || undefined,
        city: owner.city,
        state: owner.state,
        country: owner.country,
        picture: owner.picture,
        profileMediaPath: owner.profile_media_path,
        profileMediaUrl: resolveMediaUrl(owner.profile_media_path),
      },
      items: itemsResult.rows.map(row => ({
        id: row.id,
        itemId: row.id,
        title: row.collectable_title || row.manual_name || null,
        creator: row.primary_creator || row.manual_author || null,
        year: row.year || row.manual_year || null,
        collectable: row.collectable_id ? {
          id: row.collectable_id,
          title: row.collectable_title,
          primaryCreator: row.primary_creator,
          coverUrl: row.cover_url,
          coverMediaId: row.cover_media_id,
          coverMediaPath: row.cover_media_path,
          coverMediaUrl: resolveMediaUrl(row.cover_media_path),
          kind: row.kind,
          description: row.collectable_description,
          year: row.year,
          tags: row.tags,
        } : null,
        manual: row.manual_id ? {
          id: row.manual_id,
          name: row.manual_name,
          author: row.manual_author,
          description: row.manual_description,
          year: row.manual_year,
          ageStatement: row.manual_age_statement,
          specialMarkings: row.manual_special_markings,
          labelColor: row.manual_label_color,
          regionalItem: row.manual_regional_item,
          edition: row.manual_edition,
          barcode: row.manual_barcode,
          limitedEdition: row.limited_edition,
          itemSpecificText: row.item_specific_text,
          coverMediaPath: row.manual_cover_media_path || null,
          coverMediaUrl: resolveMediaUrl(row.manual_cover_media_path),
        } : null,
        position: row.position,
        notes: row.notes,
        rating: row.rating,
        createdAt: row.created_at,
      })),
      displayHints: getDisplayHints(null),
    };

    await applyManualCoverPrivacy([entry], viewerId);
    res.json({ entry });
  } catch (err) {
    logger.error('getFeedEntryDetails error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  getFeed,
  getFeedEntryDetails,
  _buildFeedItemsFromPayloads: buildFeedItemsFromPayloads,
  _mapFeedDetailItemRow: mapFeedDetailItemRow,
  _mergeCheckinRatingPairs: mergeCheckinRatingPairs,
  _mergeReviewedRatingPairs: mergeReviewedRatingPairs,
  _mergeAddedRatingPairs: mergeAddedRatingPairs,
};
