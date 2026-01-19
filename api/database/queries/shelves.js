const { query, transaction } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

/**
 * List all shelves for a user with item counts
 */
async function listForUser(userId) {
    const result = await query(
        `SELECT s.*, 
            COUNT(uc.id) as item_count
     FROM shelves s
     LEFT JOIN user_collections uc ON uc.shelf_id = s.id
     WHERE s.owner_id = $1
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
        [userId]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Get a shelf by ID (with ownership check)
 */
async function getById(shelfId, userId) {
    const result = await query(
        `SELECT * FROM shelves WHERE id = $1 AND owner_id = $2`,
        [shelfId, userId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get shelf for viewing (respects visibility and friendship)
 */
async function getForViewing(shelfId, viewerId) {
    const result = await query(
        `SELECT s.* FROM shelves s
     WHERE s.id = $1
     AND (
       s.owner_id = $2
       OR s.visibility = 'public'
       OR (s.visibility = 'friends' AND EXISTS (
         SELECT 1 FROM friendships f
         WHERE f.status = 'accepted'
         AND ((f.requester_id = s.owner_id AND f.addressee_id = $2)
              OR (f.requester_id = $2 AND f.addressee_id = s.owner_id))
       ))
     )`,
        [shelfId, viewerId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Create a new shelf
 */
async function create({ userId, name, type, description, visibility = 'private' }) {
    const result = await query(
        `INSERT INTO shelves (owner_id, name, type, description, visibility)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [userId, name, type, description, visibility]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Update a shelf
 */
async function update(shelfId, userId, updates) {
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
        return getById(shelfId, userId);
    }

    values.push(shelfId, userId);
    const result = await query(
        `UPDATE shelves SET ${fields.join(', ')} 
     WHERE id = $${paramIndex} AND owner_id = $${paramIndex + 1}
     RETURNING *`,
        values
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Delete a shelf
 */
async function remove(shelfId, userId) {
    const result = await query(
        `DELETE FROM shelves WHERE id = $1 AND owner_id = $2 RETURNING id`,
        [shelfId, userId]
    );
    return result.rowCount > 0;
}

/**
 * Get items on a shelf with collectable/manual details
 */
async function getItems(shelfId, userId, { limit = 100, offset = 0 } = {}) {
    const result = await query(
        `SELECT uc.id, uc.user_id, uc.shelf_id, uc.collectable_id, uc.manual_id,
            uc.position, uc.format, uc.notes, uc.created_at,
            ur.rating as rating,
            c.title as collectable_title,
            c.subtitle as collectable_subtitle,
            c.description as collectable_description,
            c.primary_creator as collectable_creator,
            c.publishers as collectable_publishers,
            c.year as collectable_year,
            c.formats as collectable_formats,
            c.system_name as collectable_system_name,
            c.tags as collectable_tags,
            c.images as collectable_images,
            c.identifiers as collectable_identifiers,
            c.sources as collectable_sources,
            c.fingerprint as collectable_fingerprint,
            c.lightweight_fingerprint as collectable_lightweight_fingerprint,
            c.external_id as collectable_external_id,
            c.cover_url as collectable_cover,
            c.cover_image_url as collectable_cover_image_url,
            c.cover_image_source as collectable_cover_image_source,
            c.attribution as collectable_attribution,
            c.cover_media_id as collectable_cover_media_id,
            m.local_path as collectable_cover_media_path,
            c.kind as collectable_kind,
            um.name as manual_name,
            um.type as manual_type,
            um.description as manual_description,
            um.author as manual_author,
            um.manufacturer as manual_manufacturer,
            um.publisher as manual_publisher,
            um.format as manual_format,
            um.year as manual_year,
            um.age_statement as manual_age_statement,
            um.special_markings as manual_special_markings,
            um.label_color as manual_label_color,
            um.regional_item as manual_regional_item,
            um.edition as manual_edition,
            um.barcode as manual_barcode,
            um.manual_fingerprint as manual_fingerprint,
            um.limited_edition as manual_limited_edition,
            um.item_specific_text as manual_item_specific_text,
            um.tags as manual_tags
     FROM user_collections uc
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
     LEFT JOIN media m ON m.id = c.cover_media_id
     LEFT JOIN user_ratings ur ON ur.user_id = uc.user_id AND ur.collectable_id = uc.collectable_id
     WHERE uc.shelf_id = $1 AND uc.user_id = $2
     ORDER BY uc.position ASC NULLS LAST, uc.created_at DESC
     LIMIT $3 OFFSET $4`,
        [shelfId, userId, limit, offset]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Get items on a shelf for viewing (no user_id filter)
 */
async function getItemsForViewing(shelfId, { limit = 100, offset = 0 } = {}) {
    const result = await query(
        `SELECT uc.id, uc.user_id, uc.shelf_id, uc.collectable_id, uc.manual_id,
            uc.position, uc.format, uc.notes, uc.created_at,
            ur.rating as rating,
            c.title as collectable_title,
            c.subtitle as collectable_subtitle,
            c.description as collectable_description,
            c.primary_creator as collectable_creator,
            c.publishers as collectable_publishers,
            c.year as collectable_year,
            c.formats as collectable_formats,
            c.system_name as collectable_system_name,
            c.tags as collectable_tags,
            c.images as collectable_images,
            c.identifiers as collectable_identifiers,
            c.sources as collectable_sources,
            c.fingerprint as collectable_fingerprint,
            c.lightweight_fingerprint as collectable_lightweight_fingerprint,
            c.external_id as collectable_external_id,
            c.cover_url as collectable_cover,
            c.cover_image_url as collectable_cover_image_url,
            c.cover_image_source as collectable_cover_image_source,
            c.attribution as collectable_attribution,
            c.cover_media_id as collectable_cover_media_id,
            m.local_path as collectable_cover_media_path,
            c.kind as collectable_kind,
            um.name as manual_name,
            um.type as manual_type,
            um.description as manual_description,
            um.author as manual_author,
            um.manufacturer as manual_manufacturer,
            um.publisher as manual_publisher,
            um.format as manual_format,
            um.year as manual_year,
            um.age_statement as manual_age_statement,
            um.special_markings as manual_special_markings,
            um.label_color as manual_label_color,
            um.regional_item as manual_regional_item,
            um.edition as manual_edition,
            um.barcode as manual_barcode,
            um.manual_fingerprint as manual_fingerprint,
            um.limited_edition as manual_limited_edition,
            um.item_specific_text as manual_item_specific_text,
            um.tags as manual_tags
     FROM user_collections uc
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
     LEFT JOIN media m ON m.id = c.cover_media_id
     LEFT JOIN user_ratings ur ON ur.user_id = uc.user_id AND ur.collectable_id = uc.collectable_id
     WHERE uc.shelf_id = $1
     ORDER BY uc.position ASC NULLS LAST, uc.created_at DESC
     LIMIT $2 OFFSET $3`,
        [shelfId, limit, offset]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Add a collectable to a shelf
 */
async function addCollectable({ userId, shelfId, collectableId, format, notes, rating, position }) {
    const result = await query(
        `INSERT INTO user_collections (user_id, shelf_id, collectable_id, format, notes, rating, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, shelf_id, collectable_id) DO UPDATE
     SET format = COALESCE(EXCLUDED.format, user_collections.format),
         notes = COALESCE(EXCLUDED.notes, user_collections.notes),
         rating = COALESCE(EXCLUDED.rating, user_collections.rating)
     RETURNING *`,
        [userId, shelfId, collectableId, format, notes, rating, position]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Add a manual entry to a shelf
 */
async function addManual({
    userId,
    shelfId,
    name,
    type,
    description,
    author,
    publisher,
    manufacturer,
    format,
    year,
    ageStatement,
    specialMarkings,
    labelColor,
    regionalItem,
    edition,
    barcode,
    manualFingerprint,
    tags,
    limitedEdition,
    itemSpecificText,
}) {
    return transaction(async (client) => {
        // Create manual entry
        const manualResult = await client.query(
            `INSERT INTO user_manuals (
        user_id, shelf_id, name, type, description, author, publisher, manufacturer, format, year,
        age_statement, special_markings, label_color, regional_item, edition, barcode, manual_fingerprint, tags,
        limited_edition, item_specific_text
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
            [
                userId,
                shelfId,
                name,
                type,
                description,
                author,
                publisher,
                manufacturer,
                format,
                year,
                ageStatement,
                specialMarkings,
                labelColor,
                regionalItem,
                edition,
                barcode,
                manualFingerprint,
                tags || [],
                limitedEdition,
                itemSpecificText,
            ]
        );
        const manual = manualResult.rows[0];

        // Add to user_collections
        const collectionResult = await client.query(
            `INSERT INTO user_collections (user_id, shelf_id, manual_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
            [userId, shelfId, manual.id]
        );

        return {
            collection: rowToCamelCase(collectionResult.rows[0]),
            manual: rowToCamelCase(manual),
        };
    });
}

async function findManualByFingerprint({ userId, shelfId, manualFingerprint }) {
    if (!manualFingerprint) return null;
    const result = await query(
        `SELECT * FROM user_manuals
     WHERE user_id = $1 AND shelf_id = $2 AND manual_fingerprint = $3
     LIMIT 1`,
        [userId, shelfId, manualFingerprint]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function findManualCollection({ userId, shelfId, manualId }) {
    const result = await query(
        `SELECT * FROM user_collections
     WHERE user_id = $1 AND shelf_id = $2 AND manual_id = $3
     LIMIT 1`,
        [userId, shelfId, manualId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function addManualCollection({ userId, shelfId, manualId }) {
    const result = await query(
        `INSERT INTO user_collections (user_id, shelf_id, manual_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
        [userId, shelfId, manualId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Remove an item from a shelf
 */
async function removeItem(itemId, userId, shelfId) {
    const result = await query(
        `DELETE FROM user_collections 
     WHERE id = $1 AND user_id = $2 AND shelf_id = $3
     RETURNING *`,
        [itemId, userId, shelfId]
    );
    return result.rowCount > 0;
}

/**
 * List shelves visible to a viewer (for profile pages)
 * @param {string} ownerId - The owner of the shelves
 * @param {string|null} viewerId - The person viewing (null if unauthenticated)
 */
async function listVisibleForUser(ownerId, viewerId = null) {
    // If viewer is the owner, show all shelves
    if (viewerId && ownerId === viewerId) {
        return listForUser(ownerId);
    }

    // Check if they're friends
    let isFriend = false;
    if (viewerId) {
        const friendResult = await query(
            `SELECT 1 FROM friendships 
             WHERE status = 'accepted'
        AND((requester_id = $1 AND addressee_id = $2)
        OR(requester_id = $2 AND addressee_id = $1))`,
            [ownerId, viewerId]
        );
        isFriend = friendResult.rows.length > 0;
    }

    // Build visibility filter
    const visibilityConditions = ["s.visibility = 'public'"];
    if (isFriend) {
        visibilityConditions.push("s.visibility = 'friends'");
    }

    const result = await query(
        `SELECT s.*,
        COUNT(uc.id) as item_count
         FROM shelves s
         LEFT JOIN user_collections uc ON uc.shelf_id = s.id
         WHERE s.owner_id = $1 AND(${visibilityConditions.join(' OR ')})
         GROUP BY s.id
         ORDER BY s.created_at DESC`,
        [ownerId]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Update rating for a user collection item
 * @param {number} itemId - The user_collections id
 * @param {string} userId - The user's UUID
 * @param {number} shelfId - The shelf id
 * @param {number|null} rating - Rating from 0 to 5 (supports half-points like 4.5)
 */
async function updateItemRating(itemId, userId, shelfId, rating) {
    const result = await query(
        `UPDATE user_collections 
         SET rating = $1
         WHERE id = $2 AND user_id = $3 AND shelf_id = $4
         RETURNING *`,
        [rating, itemId, userId, shelfId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get a single collection item by ID with full details
 */
async function getItemById(itemId, userId, shelfId) {
    const result = await query(
        `SELECT uc.*, 
            c.id as collectable_id,
            c.title as collectable_title,
            c.subtitle as collectable_subtitle,
            c.primary_creator as collectable_creator,
            c.cover_url as collectable_cover,
            c.kind as collectable_kind,
            c.formats as collectable_formats,
            c.system_name as collectable_system_name,
            m.local_path as collectable_cover_media_path
         FROM user_collections uc
         LEFT JOIN collectables c ON c.id = uc.collectable_id
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE uc.id = $1 AND uc.user_id = $2 AND uc.shelf_id = $3`,
        [itemId, userId, shelfId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

module.exports = {
    listForUser,
    getById,
    getForViewing,
    create,
    update,
    remove,
    getItems,
    getItemsForViewing,
    addCollectable,
    addManual,
    findManualByFingerprint,
    findManualCollection,
    addManualCollection,
    removeItem,
    listVisibleForUser,
    updateItemRating,
    getItemById,
};
