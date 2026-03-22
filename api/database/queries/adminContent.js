const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * List shelves with owner info and item counts for admin browsing
 */
async function listShelves({
  limit = 20,
  offset = 0,
  type = null,
  userId = null,
  search = null,
}) {
  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (type) {
    whereConditions.push(`s.type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }

  if (userId) {
    whereConditions.push(`s.owner_id = $${paramIndex}`);
    params.push(userId);
    paramIndex++;
  }

  if (search) {
    whereConditions.push(`s.name ILIKE $${paramIndex}`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const countResult = await query(
    `SELECT COUNT(*) as count FROM shelves s ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  params.push(limit, offset);
  const result = await query(
    `SELECT s.id, s.name, s.type, s.description, s.visibility,
            s.created_at, s.updated_at,
            u.id as owner_id, u.username as owner_username, u.picture as owner_picture,
            (SELECT COUNT(*) FROM user_collections uc WHERE uc.shelf_id = s.id) as item_count
     FROM shelves s
     LEFT JOIN users u ON u.id = s.owner_id
     ${whereClause}
     ORDER BY s.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    shelves: result.rows.map(rowToCamelCase),
    total,
    hasMore: offset + result.rows.length < total,
  };
}

/**
 * Get a single shelf by ID with owner info
 */
async function getShelfById(shelfId) {
  const result = await query(
    `SELECT s.id, s.name, s.type, s.description, s.visibility,
            s.created_at, s.updated_at,
            u.id as owner_id, u.username as owner_username, u.picture as owner_picture,
            (SELECT COUNT(*) FROM user_collections uc WHERE uc.shelf_id = s.id) as item_count
     FROM shelves s
     LEFT JOIN users u ON u.id = s.owner_id
     WHERE s.id = $1`,
    [shelfId]
  );

  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get items on a shelf with collectable/manual details
 */
async function getShelfItems(shelfId, { limit = 20, offset = 0 }) {
  const countResult = await query(
    'SELECT COUNT(*) as count FROM user_collections WHERE shelf_id = $1',
    [shelfId]
  );
  const total = parseInt(countResult.rows[0].count);

  const result = await query(
    `SELECT uc.id, uc.position, uc.format, uc.notes, uc.rating, uc.created_at,
            c.id as collectable_id, c.title, c.primary_creator, c.kind,
            c.cover_url, c.year,
            um.id as manual_id, um.name as manual_name, um.author as manual_author,
            um.type as manual_type
     FROM user_collections uc
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
     WHERE uc.shelf_id = $1
     ORDER BY uc.position ASC NULLS LAST, uc.created_at DESC
     LIMIT $2 OFFSET $3`,
    [shelfId, limit, offset]
  );

  return {
    items: result.rows.map(rowToCamelCase),
    total,
    hasMore: offset + result.rows.length < total,
  };
}

module.exports = {
  listShelves,
  getShelfById,
  getShelfItems,
};
