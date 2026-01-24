const feedQueries = require('../database/queries/feed');
const shelvesQueries = require('../database/queries/shelves');
const friendshipQueries = require('../database/queries/friendships');
const eventSocialQueries = require('../database/queries/eventSocial');
const { markNewsItemsSeen } = require('../database/queries/newsSeen');
const { query } = require('../database/pg');
const { getNewsRecommendationsForUser } = require('../services/discovery/newsRecommendations');
const { rowToCamelCase, parsePagination } = require('../database/queries/utils');

const PREVIEW_PAYLOAD_LIMIT = parseInt(process.env.FEED_AGGREGATE_PREVIEW_LIMIT || '5', 10);
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
    'checkin.activity': {
      showShelfCard: false,
      sectionTitle: null,
      itemDisplayMode: 'checkin',
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
    console.warn('[Feed] Failed to mark news items seen:', err.message);
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
      const isManual = payload.manualId || payload.manual_id || (!collectableId && (payload.name || payload.title));

      if (isManual) {
        // Treat as manual item
        const name = payload.name || payload.title || null;
        items.push({
          id: payload.itemId || payload.id || null,
          manual: {
            name,
            title: name,
            author: payload.author || payload.primaryCreator || null,
          },
        });
      } else {
        items.push({
          id: payload.itemId || payload.id || null,
          collectableId,
          collectable: {
            id: collectableId,
            title: payload.title || payload.name || null,
            primaryCreator: payload.primaryCreator || payload.author || null,
            coverUrl: payload.coverUrl || null,
            coverMediaPath: payload.coverMediaPath || null,
            kind: payload.type || payload.kind || null,
          },
        });
      }
    } else if (eventType === 'item.manual_added') {
      const name = payload.name || payload.title || null;
      items.push({
        id: payload.itemId || payload.id || null,
        manual: {
          name,
          title: name,
          author: payload.author || null,
          ageStatement: payload.ageStatement || null,
          year: payload.year || null,
          specialMarkings: payload.specialMarkings || null,
          labelColor: payload.labelColor || null,
          regionalItem: payload.regionalItem || null,
          edition: payload.edition || null,
          description: payload.description || null,
          barcode: payload.barcode || null,
          limitedEdition: payload.limitedEdition || null,
          itemSpecificText: payload.itemSpecificText || null,
        },
      });
    } else if (eventType === 'item.rated') {
      // Rating events - include the rating value
      const collectableId = payload.collectableId || payload.collectable_id || null;
      items.push({
        id: payload.itemId || payload.id || null,
        collectableId,
        rating: payload.rating || null,
        collectable: {
          id: collectableId,
          title: payload.title || payload.name || null,
          primaryCreator: payload.primaryCreator || payload.author || null,
          coverUrl: payload.coverUrl || null,
          coverMediaPath: payload.coverMediaPath || null,
          kind: payload.type || payload.kind || null,
        },
      });
    }
    if (items.length >= maxItems) break;
  }
  return items;
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
            um.name as manual_name, um.author as manual_author, um.limited_edition, um.item_specific_text
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
          kind: row.kind,
        } : null,
        manual: row.manual_id ? {
          id: row.manual_id,
          name: row.manual_name,
          author: row.manual_author,
          limitedEdition: row.limited_edition,
          itemSpecificText: row.item_specific_text,
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
          console.warn('[Feed] Failed to build news recommendations:', newsErr.message);
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
        },
      };

      if (isCheckIn) {
        // Check-in event: include collectable info and check-in specific fields
        entry.checkinStatus = e.checkinStatus;
        entry.visibility = e.visibility;
        entry.note = e.note;
        entry.collectable = {
          id: e.collectableId,
          title: e.collectableTitle,
          primaryCreator: e.collectableCreator,
          coverUrl: e.collectableCoverUrl,
          coverMediaPath: e.collectableCoverMediaPath,
          kind: e.collectableKind,
        };
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
        console.warn('[Feed] Failed to build news recommendations:', newsErr.message);
      }
    }

    res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries });
  } catch (err) {
    console.error('getFeed error:', err);
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
                c.cover_url as collectable_cover_url, c.kind as collectable_kind,
                cm.local_path as collectable_cover_media_path
         FROM event_aggregates a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
         LEFT JOIN shelves s ON s.id = a.shelf_id
         LEFT JOIN collectables c ON c.id = a.collectable_id
         LEFT JOIN media cm ON cm.id = c.cover_media_id
         WHERE a.id = $1`,
        [aggregateId]
      );

      if (!aggregateResult.rows.length) return res.status(404).json({ error: 'Feed entry not found' });

      const aggregate = rowToCamelCase(aggregateResult.rows[0]);
      const isCheckIn = aggregate.eventType === 'checkin.activity';
      const isOwner = !!(viewerId && aggregate.userId && String(viewerId) === String(aggregate.userId));

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

        if (itemIds.length) {
          const itemsResult = await query(
            `SELECT uc.id, uc.collectable_id, uc.manual_id,
                    c.title as collectable_title,
                    c.primary_creator as collectable_primary_creator,
                    c.cover_url as collectable_cover_url,
                    c.kind as collectable_kind,
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
                    um.item_specific_text
             FROM user_collections uc
             LEFT JOIN collectables c ON c.id = uc.collectable_id
             LEFT JOIN user_manuals um ON um.id = uc.manual_id
             WHERE uc.id = ANY($1)
             ORDER BY array_position($1, uc.id)`,
            [itemIds]
          );

          items = itemsResult.rows.map((row) => {
            const resolvedTitle = row.collectable_title || row.manual_name || 'Unknown item';
            return {
              id: row.id,
              collectableId: row.collectable_id || null,
              collectable: row.collectable_id ? {
                id: row.collectable_id,
                title: resolvedTitle,
                primaryCreator: row.collectable_primary_creator || null,
                coverUrl: row.collectable_cover_url || null,
                kind: row.collectable_kind || null,
              } : null,
              manual: row.manual_id ? {
                name: resolvedTitle,
                title: resolvedTitle,
                author: row.manual_author || null,
                description: row.manual_description || null,
                year: row.manual_year || null,
                ageStatement: row.manual_age_statement || null,
                specialMarkings: row.manual_special_markings || null,
                labelColor: row.manual_label_color || null,
                regionalItem: row.manual_regional_item || null,
                edition: row.manual_edition || null,
                edition: row.manual_edition || null,
                barcode: row.manual_barcode || null,
                limitedEdition: row.limited_edition || null,
                itemSpecificText: row.item_specific_text || null,
              } : null,
            };
          });

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
        },
      };

      if (isCheckIn) {
        entry.checkinStatus = aggregate.checkinStatus;
        entry.visibility = aggregate.visibility;
        entry.note = aggregate.note;
        entry.collectable = {
          id: aggregate.collectableId,
          title: aggregate.collectableTitle,
          primaryCreator: aggregate.collectableCreator,
          coverUrl: aggregate.collectableCoverUrl,
          coverMediaPath: aggregate.collectableCoverMediaPath,
          kind: aggregate.collectableKind,
        };
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
      return res.json({ entry });
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
              um.item_specific_text
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
      },
      items: itemsResult.rows.map(row => ({
        id: row.id,
        collectable: row.collectable_id ? {
          id: row.collectable_id,
          title: row.collectable_title,
          primaryCreator: row.primary_creator,
          coverUrl: row.cover_url,
          coverMediaId: row.cover_media_id,
          coverMediaPath: row.cover_media_path,
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
        } : null,
        position: row.position,
        notes: row.notes,
        rating: row.rating,
        createdAt: row.created_at,
      })),
      displayHints: getDisplayHints(null),
    };

    res.json({ entry });
  } catch (err) {
    console.error('getFeedEntryDetails error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getFeed, getFeedEntryDetails };
