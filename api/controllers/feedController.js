const feedQueries = require('../database/queries/feed');
const shelvesQueries = require('../database/queries/shelves');
const friendshipQueries = require('../database/queries/friendships');
const { query } = require('../database/pg');
const { rowToCamelCase, parsePagination } = require('../database/queries/utils');

async function summarizeItems(shelfIds) {
  if (!shelfIds.length) return new Map();

  const result = await query(
    `SELECT uc.shelf_id,
            uc.id, uc.collectable_id, uc.manual_id, uc.position, uc.notes, uc.rating,
            c.title as collectable_title, c.primary_creator, c.cover_url, c.kind,
            um.name as manual_name, um.author as manual_author
     FROM user_collections uc
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
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
    const friendIds = await friendshipQueries.getAcceptedFriendIds(viewerId);

    let shelves = [];

    if (ownerOverride) {
      // Specific user's shelves
      const isOwner = ownerOverride === viewerId;
      const isFriend = friendIds.includes(ownerOverride);

      let visibilityFilter = ['public'];
      if (isOwner) visibilityFilter = ['public', 'friends', 'private'];
      else if (isFriend) visibilityFilter = ['public', 'friends'];

      const result = await query(
        `SELECT s.*, u.username, u.picture as owner_picture, u.first_name, u.last_name, u.city, u.state, u.country
         FROM shelves s
         JOIN users u ON u.id = s.owner_id
         WHERE s.owner_id = $1
         AND s.visibility = ANY($2)
         ${typeFilter ? 'AND s.type = $3' : ''}
         ORDER BY s.updated_at DESC
         LIMIT $${typeFilter ? 4 : 3} OFFSET $${typeFilter ? 5 : 4}`,
        typeFilter
          ? [ownerOverride, visibilityFilter, typeFilter, limit, offset]
          : [ownerOverride, visibilityFilter, limit, offset]
      );
      shelves = result.rows;

    } else if (scope === 'friends') {
      if (!friendIds.length) {
        return res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries: [] });
      }

      const result = await query(
        `SELECT s.*, u.username, u.picture as owner_picture, u.first_name, u.last_name, u.city, u.state, u.country
         FROM shelves s
         JOIN users u ON u.id = s.owner_id
         WHERE s.owner_id = ANY($1)
         AND s.visibility IN ('public', 'friends')
         ${typeFilter ? 'AND s.type = $2' : ''}
         ORDER BY s.updated_at DESC
         LIMIT $${typeFilter ? 3 : 2} OFFSET $${typeFilter ? 4 : 3}`,
        typeFilter
          ? [friendIds, typeFilter, limit, offset]
          : [friendIds, limit, offset]
      );
      shelves = result.rows;

    } else if (scope === 'mine') {
      const result = await query(
        `SELECT s.*, u.username, u.picture as owner_picture, u.first_name, u.last_name, u.city, u.state, u.country
         FROM shelves s
         JOIN users u ON u.id = s.owner_id
         WHERE s.owner_id = $1
         ${typeFilter ? 'AND s.type = $2' : ''}
         ORDER BY s.updated_at DESC
         LIMIT $${typeFilter ? 3 : 2} OFFSET $${typeFilter ? 4 : 3}`,
        typeFilter
          ? [viewerId, typeFilter, limit, offset]
          : [viewerId, limit, offset]
      );
      shelves = result.rows;

    } else {
      // Global feed - public shelves only
      const result = await query(
        `SELECT s.*, u.username, u.picture as owner_picture, u.first_name, u.last_name, u.city, u.state, u.country
         FROM shelves s
         JOIN users u ON u.id = s.owner_id
         WHERE s.visibility = 'public'
         AND s.owner_id != $1
         ${typeFilter ? 'AND s.type = $2' : ''}
         ORDER BY s.updated_at DESC
         LIMIT $${typeFilter ? 3 : 2} OFFSET $${typeFilter ? 4 : 3}`,
        typeFilter
          ? [viewerId, typeFilter, limit, offset]
          : [viewerId, limit, offset]
      );
      shelves = result.rows;
    }

    if (!shelves.length) {
      return res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries: [] });
    }

    const shelfIds = shelves.map(s => s.id);
    const [itemMap, countMap] = await Promise.all([
      summarizeItems(shelfIds),
      getShelfCounts(shelfIds),
    ]);

    const entries = shelves.map(s => ({
      shelf: {
        id: s.id,
        name: s.name,
        type: s.type,
        description: s.description,
        visibility: s.visibility,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        itemCount: countMap.get(String(s.id)) || 0,
      },
      owner: {
        id: s.owner_id,
        username: s.username,
        name: [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || undefined,
        city: s.city,
        state: s.state,
        country: s.country,
        picture: s.owner_picture,
      },
      items: itemMap.get(String(s.id)) || [],
    }));

    res.json({ scope, filters: { type: typeFilter }, paging: { limit, offset }, entries });
  } catch (err) {
    console.error('getFeed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getFeedEntryDetails(req, res) {
  try {
    const shelfId = parseInt(req.params.shelfId, 10);
    if (isNaN(shelfId)) return res.status(400).json({ error: 'Invalid shelf id' });

    const viewerId = req.user.id;
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
              c.title as collectable_title, c.primary_creator, c.cover_url, c.kind,
              c.description as collectable_description, c.year, c.tags,
              um.name as manual_name, um.author as manual_author, um.description as manual_description
       FROM user_collections uc
       LEFT JOIN collectables c ON c.id = uc.collectable_id
       LEFT JOIN user_manuals um ON um.id = uc.manual_id
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
