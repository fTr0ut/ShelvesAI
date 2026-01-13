const feedQueries = require('../database/queries/feed');
const shelvesQueries = require('../database/queries/shelves');
const friendshipQueries = require('../database/queries/friendships');
const eventSocialQueries = require('../database/queries/eventSocial');
const { query } = require('../database/pg');
const { rowToCamelCase, parsePagination } = require('../database/queries/utils');

async function summarizeItems(shelfIds) {
  if (!shelfIds.length) return new Map();

  const result = await query(
    `SELECT uc.shelf_id,
            uc.id, uc.collectable_id, uc.manual_id, uc.position, uc.notes, uc.rating,
            c.title as collectable_title, c.primary_creator, c.cover_url, c.cover_media_id, c.kind,
            m.local_path as cover_media_path,
            um.name as manual_name, um.author as manual_author
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

    const viewerId = req.user.id;
    // const friendIds = await friendshipQueries.getAcceptedFriendIds(viewerId); // Used in legacy, not needed here

    let events = [];

    if (ownerOverride) {
      events = await feedQueries.getMyFeed(ownerOverride, { limit, offset, type: typeFilter });
    } else if (scope === 'friends') {
      events = await feedQueries.getFriendsFeed(viewerId, { limit, offset, type: typeFilter });
    } else if (scope === 'mine') {
      events = await feedQueries.getMyFeed(viewerId, { limit, offset, type: typeFilter });
    } else {
      events = await feedQueries.getPublicFeed({ limit, offset, type: typeFilter });
    }

    if (!events.length) {
      return res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries: [] });
    }

    // Get shelf counts
    const shelfIds = [...new Set(events.map(e => e.shelfId).filter(Boolean))];
    const countMap = await getShelfCounts(shelfIds);
    const aggregateIds = [...new Set(events.map(e => e.id).filter(Boolean))];
    const socialMap = await eventSocialQueries.getSocialSummaries(aggregateIds, viewerId);

    const entries = events.map(e => {
      const payloads = Array.isArray(e.previewPayloads) ? e.previewPayloads : [];
      let feedItems = [];

      // Construct item previews from aggregate payloads if applicable
      if (e.eventType === 'item.collectable_added') {
        feedItems = payloads.map((payload) => ({
          id: payload?.itemId,
          collectable: {
            title: payload?.title,
            primaryCreator: payload?.primaryCreator,
            coverUrl: payload?.coverUrl,
            kind: payload?.type || payload?.kind,
          }
        }));
      } else if (e.eventType === 'item.manual_added') {
        feedItems = payloads.map((payload) => ({
          id: payload?.itemId,
          manual: {
            name: payload?.name,
            title: payload?.name,
          }
        }));
      }

      const social = socialMap.get(e.id) || {};

      return {
        id: e.id,
        aggregateId: e.id,
        eventType: e.eventType,
        createdAt: e.createdAt,
        eventItemCount: e.itemCount || 0,
        likeCount: social.likeCount || 0,
        commentCount: social.commentCount || 0,
        hasLiked: !!social.hasLiked,
        topComment: social.topComment || null,
        shelf: {
          id: e.shelfId,
          name: e.shelfName,
          type: e.shelfType,
          description: e.shelfDescription,
          visibility: 'public',
          createdAt: e.createdAt, // aggregate start
          updatedAt: e.lastActivityAt || e.createdAt, // use latest activity for display
          itemCount: countMap.get(String(e.shelfId)) || 0,
        },
        owner: {
          id: e.userId,
          username: e.username,
          name: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || undefined,
          city: e.city,
          state: e.state,
          country: e.country,
          picture: e.userPicture,
        },
        items: feedItems,
      };
    });

    res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries });
  } catch (err) {
    console.error('getFeed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getFeedEntryDetails(req, res) {
  try {
    const rawId = String(req.params.shelfId || '').trim();
    const shelfId = parseInt(rawId, 10);
    const isNumeric = !Number.isNaN(shelfId);
    const aggregateId = isNumeric ? null : rawId;

    const viewerId = req.user.id;
    if (!isNumeric && !aggregateId) return res.status(400).json({ error: 'Invalid feed entry id' });

    if (!isNumeric) {
      const aggregateResult = await query(
        `SELECT a.*, 
                u.username, u.first_name, u.last_name, u.picture, u.city, u.state, u.country,
                s.id as shelf_id, s.owner_id as shelf_owner_id,
                s.name as shelf_name, s.type as shelf_type, s.description as shelf_description, s.visibility as shelf_visibility
         FROM event_aggregates a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN shelves s ON s.id = a.shelf_id
         WHERE a.id = $1`,
        [aggregateId]
      );

      if (!aggregateResult.rows.length) return res.status(404).json({ error: 'Feed entry not found' });

      const aggregate = rowToCamelCase(aggregateResult.rows[0]);
      const resolvedShelfId = aggregate.shelfId;
      let shelf = null;
      if (resolvedShelfId) {
        shelf = await shelvesQueries.getForViewing(resolvedShelfId, viewerId);
        if (!shelf) return res.status(404).json({ error: 'Feed entry not found' });
      }

      const itemsResult = await query(
        `SELECT e.id, e.event_type, e.payload, e.created_at,
                c.title as collectable_title,
                c.primary_creator as collectable_primary_creator,
                c.cover_url as collectable_cover_url,
                c.kind as collectable_kind,
                um.name as manual_name,
                um.author as manual_author
         FROM event_logs e
         LEFT JOIN user_collections uc
           ON uc.id = CASE
             WHEN (e.payload->>'itemId') ~ '^[0-9]+$'
             THEN (e.payload->>'itemId')::int
             ELSE NULL
           END
         LEFT JOIN collectables c
           ON c.id = COALESCE(
             uc.collectable_id,
             CASE
               WHEN (e.payload->>'collectableId') ~ '^[0-9]+$'
               THEN (e.payload->>'collectableId')::int
               ELSE NULL
             END
           )
         LEFT JOIN user_manuals um
           ON um.id = COALESCE(
             uc.manual_id,
             CASE
               WHEN (e.payload->>'manualId') ~ '^[0-9]+$'
               THEN (e.payload->>'manualId')::int
               ELSE NULL
             END
           )
         WHERE e.aggregate_id = $1
         ORDER BY e.created_at ASC`,
        [aggregateId]
      );

      const items = itemsResult.rows.map((row) => {
        const payload = row.payload || {};
        const resolvedTitle = payload.title || payload.name || row.collectable_title || row.manual_name || 'Unknown item';
        if (row.event_type === 'item.collectable_added') {
          return {
            id: row.id,
            collectable: {
              title: resolvedTitle,
              primaryCreator: payload.primaryCreator || row.collectable_primary_creator || null,
              coverUrl: payload.coverUrl || row.collectable_cover_url || null,
              kind: payload.type || payload.kind || row.collectable_kind || null,
            },
          };
        }
        if (row.event_type === 'item.manual_added') {
          return {
            id: row.id,
            manual: {
              name: resolvedTitle,
              title: resolvedTitle,
              author: payload.author || row.manual_author || null,
            },
          };
        }
        return {
          id: row.id,
          payload,
        };
      });

      const entry = {
        id: aggregate.id,
        aggregateId: aggregate.id,
        eventType: aggregate.eventType,
        createdAt: aggregate.createdAt,
        updatedAt: aggregate.lastActivityAt || aggregate.createdAt,
        itemCount: aggregate.itemCount || items.length,
        likeCount: 0,
        commentCount: 0,
        hasLiked: false,
        shelf: shelf ? {
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
        },
        owner: {
          id: aggregate.userId,
          username: aggregate.username,
          name: [aggregate.firstName, aggregate.lastName].filter(Boolean).join(' ').trim() || undefined,
          city: aggregate.city,
          state: aggregate.state,
          country: aggregate.country,
          picture: aggregate.picture,
        },
        items,
      };

      const socialMap = await eventSocialQueries.getSocialSummaries([aggregate.id], viewerId);
      const social = socialMap.get(aggregate.id) || {};
      entry.likeCount = social.likeCount || 0;
      entry.commentCount = social.commentCount || 0;
      entry.hasLiked = !!social.hasLiked;
      entry.topComment = social.topComment || null;

      return res.json({ entry });
    }

    const shelf = await shelvesQueries.getForViewing(shelfId, viewerId);
    if (!shelf) return res.status(404).json({ error: 'Feed entry not found' });

    // Get owner info
    const ownerResult = await query(
      `SELECT id, username, first_name, last_name, picture, city, state, country 
       FROM users WHERE id = $1`,
      [shelf.ownerId]
    );
    const owner = ownerResult.rows[0];

    // Get all items
    const itemsResult = await query(
      `SELECT uc.*, 
              c.title as collectable_title, c.primary_creator, c.cover_url, c.cover_media_id, c.kind,
              m.local_path as cover_media_path,
              c.description as collectable_description, c.year, c.tags,
              um.name as manual_name, um.author as manual_author, um.description as manual_description
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
        } : null,
        position: row.position,
        notes: row.notes,
        rating: row.rating,
        createdAt: row.created_at,
      })),
    };

    res.json({ entry });
  } catch (err) {
    console.error('getFeedEntryDetails error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getFeed, getFeedEntryDetails };
