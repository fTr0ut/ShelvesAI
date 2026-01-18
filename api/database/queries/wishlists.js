/**
 * Wishlists database queries
 */

const { query, transaction } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * List all wishlists for a user
 */
async function listForUser(userId) {
    const result = await query(
        `SELECT w.*, 
            COUNT(wi.id) as item_count
         FROM wishlists w
         LEFT JOIN wishlist_items wi ON wi.wishlist_id = w.id
         WHERE w.user_id = $1
         GROUP BY w.id
         ORDER BY w.created_at DESC`,
        [userId]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Get a wishlist by ID (with ownership check)
 */
async function getById(wishlistId, userId) {
    const result = await query(
        `SELECT * FROM wishlists WHERE id = $1 AND user_id = $2`,
        [wishlistId, userId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get wishlist for viewing (respects visibility and friendship)
 */
async function getForViewing(wishlistId, viewerId) {
    const result = await query(
        `SELECT w.* FROM wishlists w
         WHERE w.id = $1
         AND (
           w.user_id = $2
           OR w.visibility = 'public'
           OR (w.visibility = 'friends' AND EXISTS (
             SELECT 1 FROM friendships f
             WHERE f.status = 'accepted'
             AND ((f.requester_id = w.user_id AND f.addressee_id = $2)
                  OR (f.requester_id = $2 AND f.addressee_id = w.user_id))
           ))
         )`,
        [wishlistId, viewerId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * List wishlists for a user that are viewable by the viewer
 * Returns wishlists based on visibility settings and friendship status
 */
async function listViewableForUser(targetUserId, viewerId) {
    const result = await query(
        `SELECT w.*, 
            COUNT(wi.id) as item_count,
            u.username as owner_username,
            u.first_name as owner_first_name
         FROM wishlists w
         LEFT JOIN wishlist_items wi ON wi.wishlist_id = w.id
         LEFT JOIN users u ON u.id = w.user_id
         WHERE w.user_id = $1
         AND (
           w.user_id = $2
           OR w.visibility = 'public'
           OR (w.visibility = 'friends' AND EXISTS (
             SELECT 1 FROM friendships f
             WHERE f.status = 'accepted'
             AND ((f.requester_id = w.user_id AND f.addressee_id = $2)
                  OR (f.requester_id = $2 AND f.addressee_id = w.user_id))
           ))
         )
         GROUP BY w.id, u.username, u.first_name
         ORDER BY w.created_at DESC`,
        [targetUserId, viewerId]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Check if a user has any wishlists viewable by the viewer
 * Used to determine whether to show "View Wishlists" button
 */
async function hasViewableWishlists(targetUserId, viewerId) {
    const result = await query(
        `SELECT EXISTS (
           SELECT 1 FROM wishlists w
           WHERE w.user_id = $1
           AND (
             w.user_id = $2
             OR w.visibility = 'public'
             OR (w.visibility = 'friends' AND EXISTS (
               SELECT 1 FROM friendships f
               WHERE f.status = 'accepted'
               AND ((f.requester_id = w.user_id AND f.addressee_id = $2)
                    OR (f.requester_id = $2 AND f.addressee_id = w.user_id))
             ))
           )
         ) as has_wishlists`,
        [targetUserId, viewerId]
    );
    return result.rows[0]?.has_wishlists || false;
}

/**
 * Create a new wishlist
 */
async function create({ userId, name, description, visibility = 'private' }) {
    const result = await query(
        `INSERT INTO wishlists (user_id, name, description, visibility)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, name, description, visibility]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Update a wishlist
 */
async function update(wishlistId, userId, updates) {
    const allowedFields = ['name', 'description', 'visibility'];
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return getById(wishlistId, userId);
    }

    values.push(wishlistId, userId);
    const result = await query(
        `UPDATE wishlists SET ${fields.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
         RETURNING *`,
        values
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Delete a wishlist
 */
async function remove(wishlistId, userId) {
    const result = await query(
        `DELETE FROM wishlists WHERE id = $1 AND user_id = $2 RETURNING id`,
        [wishlistId, userId]
    );
    return result.rowCount > 0;
}

/**
 * Get items in a wishlist
 */
async function getItems(wishlistId, { limit = 100, offset = 0 } = {}) {
    const result = await query(
        `SELECT wi.*,
            c.title as collectable_title,
            c.subtitle as collectable_subtitle,
            c.primary_creator as collectable_creator,
            c.cover_url as collectable_cover,
            c.kind as collectable_kind,
            c.system_name as collectable_system_name,
            c.formats as collectable_formats,
            m.local_path as collectable_cover_media_path
         FROM wishlist_items wi
         LEFT JOIN collectables c ON c.id = wi.collectable_id
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE wi.wishlist_id = $1
         ORDER BY wi.priority DESC, wi.created_at DESC
         LIMIT $2 OFFSET $3`,
        [wishlistId, limit, offset]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Add an item to a wishlist
 */
async function addItem({ wishlistId, collectableId, manualText, notes, priority = 0 }) {
    // Validate that either collectableId or manualText is provided
    if (!collectableId && !manualText) {
        throw new Error('Either collectableId or manualText is required');
    }

    const result = await query(
        `INSERT INTO wishlist_items (wishlist_id, collectable_id, manual_text, notes, priority)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [wishlistId, collectableId || null, manualText || null, notes, priority]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Update a wishlist item
 */
async function updateItem(itemId, wishlistId, updates) {
    const allowedFields = ['notes', 'priority', 'manual_text'];
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return null;
    }

    values.push(itemId, wishlistId);
    const result = await query(
        `UPDATE wishlist_items SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND wishlist_id = $${paramIndex + 1}
         RETURNING *`,
        values
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Remove an item from a wishlist
 */
async function removeItem(itemId, wishlistId) {
    const result = await query(
        `DELETE FROM wishlist_items WHERE id = $1 AND wishlist_id = $2 RETURNING id`,
        [itemId, wishlistId]
    );
    return result.rowCount > 0;
}

module.exports = {
    listForUser,
    listViewableForUser,
    hasViewableWishlists,
    getById,
    getForViewing,
    create,
    update,
    remove,
    getItems,
    addItem,
    updateItem,
    removeItem,
};
