/**
 * User Lists database queries
 * Custom user-created collections like "Top 10 Horror Movies"
 */

const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

const MAX_LIST_ITEMS = 10;

/**
 * List all lists for a user
 */
async function listForUser(userId) {
    const result = await query(
        `SELECT ul.*,
            (SELECT COUNT(*) FROM user_list_items WHERE list_id = ul.id) as item_count
         FROM user_lists ul
         WHERE ul.user_id = $1
         ORDER BY ul.updated_at DESC`,
        [userId]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Get a list by ID with ownership check
 */
async function getById(listId, userId) {
    const result = await query(
        `SELECT ul.*,
            (SELECT COUNT(*) FROM user_list_items WHERE list_id = ul.id) as item_count
         FROM user_lists ul
         WHERE ul.id = $1 AND ul.user_id = $2`,
        [listId, userId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get a list for viewing (respects visibility + friendship)
 */
async function getForViewing(listId, viewerId) {
    const result = await query(
        `SELECT ul.*,
            (SELECT COUNT(*) FROM user_list_items WHERE list_id = ul.id) as item_count,
            u.username as owner_username
         FROM user_lists ul
         JOIN users u ON u.id = ul.user_id
         WHERE ul.id = $1
         AND (
             ul.user_id = $2
             OR ul.visibility = 'public'
             OR (ul.visibility = 'friends' AND EXISTS (
                 SELECT 1 FROM friendships 
                 WHERE status = 'accepted'
                 AND ((sender_id = ul.user_id AND receiver_id = $2) 
                      OR (sender_id = $2 AND receiver_id = ul.user_id))
             ))
         )`,
        [listId, viewerId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Create a new list
 */
async function create({ userId, name, description, visibility = 'private' }) {
    const result = await query(
        `INSERT INTO user_lists (user_id, name, description, visibility)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, name, description, visibility]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Update a list's metadata
 */
async function update(listId, userId, { name, description, visibility }) {
    const updates = [];
    const values = [listId, userId];
    let idx = 3;

    if (name !== undefined) {
        updates.push(`name = $${idx++}`);
        values.push(name);
    }
    if (description !== undefined) {
        updates.push(`description = $${idx++}`);
        values.push(description);
    }
    if (visibility !== undefined) {
        updates.push(`visibility = $${idx++}`);
        values.push(visibility);
    }

    if (updates.length === 0) return null;

    const result = await query(
        `UPDATE user_lists 
         SET ${updates.join(', ')}
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        values
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Delete a list
 */
async function remove(listId, userId) {
    const result = await query(
        `DELETE FROM user_lists 
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [listId, userId]
    );
    return result.rowCount > 0;
}

/**
 * Get items in a list ordered by position
 */
async function getItems(listId) {
    const result = await query(
        `SELECT uli.*,
            c.id as collectable_id,
            c.title as collectable_title,
            c.subtitle as collectable_subtitle,
            c.primary_creator as collectable_creator,
            c.cover_url as collectable_cover,
            c.kind as collectable_kind,
            c.year as collectable_year,
            c.system_name as collectable_system_name,
            c.formats as collectable_formats,
            m.local_path as collectable_cover_media_path
         FROM user_list_items uli
         LEFT JOIN collectables c ON c.id = uli.collectable_id
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE uli.list_id = $1
         ORDER BY uli.position ASC`,
        [listId]
    );
    return result.rows.map(row => {
        const base = rowToCamelCase(row);
        return {
            id: base.id,
            listId: base.listId,
            position: base.position,
            notes: base.notes,
            createdAt: base.createdAt,
            collectable: {
                id: base.collectableId,
                title: base.collectableTitle,
                subtitle: base.collectableSubtitle,
                primaryCreator: base.collectableCreator,
                coverUrl: base.collectableCover,
                coverMediaPath: base.collectableCoverMediaPath,
                kind: base.collectableKind,
                year: base.collectableYear,
                formats: Array.isArray(base.collectableFormats) ? base.collectableFormats : [],
                systemName: base.collectableSystemName || null,
            },
        };
    });
}

/**
 * Get current item count for a list
 */
async function getItemCount(listId) {
    const result = await query(
        `SELECT COUNT(*) as count FROM user_list_items WHERE list_id = $1`,
        [listId]
    );
    return parseInt(result.rows[0]?.count || 0);
}

/**
 * Add an item to a list (enforces max 10 items)
 */
async function addItem({ listId, collectableId, position, notes }) {
    // Check current count
    const count = await getItemCount(listId);
    if (count >= MAX_LIST_ITEMS) {
        throw new Error(`List cannot have more than ${MAX_LIST_ITEMS} items`);
    }

    // If position not provided, add at end
    let targetPosition = position;
    if (!targetPosition) {
        targetPosition = count + 1;
    }

    // Validate position range
    if (targetPosition < 1 || targetPosition > MAX_LIST_ITEMS) {
        throw new Error(`Position must be between 1 and ${MAX_LIST_ITEMS}`);
    }

    // Shift existing items if position is taken
    await query(
        `UPDATE user_list_items 
         SET position = position + 1
         WHERE list_id = $1 AND position >= $2`,
        [listId, targetPosition]
    );

    const result = await query(
        `INSERT INTO user_list_items (list_id, collectable_id, position, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (list_id, collectable_id) DO UPDATE
         SET position = EXCLUDED.position, notes = EXCLUDED.notes
         RETURNING *`,
        [listId, collectableId, targetPosition, notes]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Remove an item from a list
 */
async function removeItem(itemId, listId) {
    // Get the position of the item being removed
    const posResult = await query(
        `SELECT position FROM user_list_items WHERE id = $1 AND list_id = $2`,
        [itemId, listId]
    );

    if (posResult.rows.length === 0) return false;

    const removedPosition = posResult.rows[0].position;

    // Delete the item
    const result = await query(
        `DELETE FROM user_list_items 
         WHERE id = $1 AND list_id = $2
         RETURNING id`,
        [itemId, listId]
    );

    if (result.rowCount === 0) return false;

    // Shift remaining items down to fill the gap
    await query(
        `UPDATE user_list_items 
         SET position = position - 1
         WHERE list_id = $1 AND position > $2`,
        [listId, removedPosition]
    );

    return true;
}

/**
 * Reorder items in a list
 * @param {number} listId - List ID
 * @param {Array<{id: number, position: number}>} itemOrders - New order of items
 */
async function reorderItems(listId, itemOrders) {
    // Validate all positions are 1-10 and no duplicates
    const positions = itemOrders.map(i => i.position);
    const uniquePositions = new Set(positions);

    if (positions.some(p => p < 1 || p > MAX_LIST_ITEMS)) {
        throw new Error(`Positions must be between 1 and ${MAX_LIST_ITEMS}`);
    }

    if (uniquePositions.size !== positions.length) {
        throw new Error('Duplicate positions not allowed');
    }

    // Update each item's position
    for (const { id, position } of itemOrders) {
        await query(
            `UPDATE user_list_items 
             SET position = $1
             WHERE id = $2 AND list_id = $3`,
            [position, id, listId]
        );
    }

    return getItems(listId);
}

module.exports = {
    listForUser,
    getById,
    getForViewing,
    create,
    update,
    remove,
    getItems,
    getItemCount,
    addItem,
    removeItem,
    reorderItems,
    MAX_LIST_ITEMS,
};
