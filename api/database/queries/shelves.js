const { query, transaction } = require('../pg');
const { verifyOwnership } = require('./ownership');

/**
 * Resolve the query executor: use the provided client if given, otherwise use the shared pool query.
 * @param {import('pg').PoolClient|null} client
 * @returns {Function}
 */
function resolveQuery(client) {
    return client ? client.query.bind(client) : query;
}
const { rowToCamelCase, parsePagination } = require('./utils');

function normalizeManualFuzzyToken(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeBarcodeToken(value) {
    if (value === undefined || value === null) return null;
    const compact = String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
    return compact || null;
}

function toSimilarityNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

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
    const owned = await verifyOwnership('shelves', shelfId, userId);
    if (!owned) return null;
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
     JOIN users u ON u.id = s.owner_id
     WHERE s.id = $1
     AND (u.is_suspended = false OR s.owner_id = $2)
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
    const owned = await verifyOwnership('shelves', shelfId, userId);
    if (!owned) return false;
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
            c.market_value as collectable_market_value,
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
            um.market_value as manual_market_value,
            um.age_statement as manual_age_statement,
            um.special_markings as manual_special_markings,
            um.label_color as manual_label_color,
            um.regional_item as manual_regional_item,
            um.edition as manual_edition,
            um.barcode as manual_barcode,
            um.manual_fingerprint as manual_fingerprint,
            um.limited_edition as manual_limited_edition,
            um.item_specific_text as manual_item_specific_text,
            um.tags as manual_tags,
            um.cover_media_path as manual_cover_media_path
     FROM user_collections uc
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
     LEFT JOIN media m ON m.id = c.cover_media_id
     LEFT JOIN user_ratings ur ON ur.user_id = uc.user_id
        AND (ur.collectable_id = uc.collectable_id OR ur.manual_id = uc.manual_id)
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
            c.market_value as collectable_market_value,
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
            um.market_value as manual_market_value,
            um.age_statement as manual_age_statement,
            um.special_markings as manual_special_markings,
            um.label_color as manual_label_color,
            um.regional_item as manual_regional_item,
            um.edition as manual_edition,
            um.barcode as manual_barcode,
            um.manual_fingerprint as manual_fingerprint,
            um.limited_edition as manual_limited_edition,
            um.item_specific_text as manual_item_specific_text,
            um.tags as manual_tags,
            um.cover_media_path as manual_cover_media_path
     FROM user_collections uc
     LEFT JOIN collectables c ON c.id = uc.collectable_id
     LEFT JOIN user_manuals um ON um.id = uc.manual_id
     LEFT JOIN media m ON m.id = c.cover_media_id
     LEFT JOIN user_ratings ur ON ur.user_id = uc.user_id
        AND (ur.collectable_id = uc.collectable_id OR ur.manual_id = uc.manual_id)
     WHERE uc.shelf_id = $1
     ORDER BY uc.position ASC NULLS LAST, uc.created_at DESC
     LIMIT $2 OFFSET $3`,
        [shelfId, limit, offset]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Add a collectable to a shelf
 * @param {object} params
 * @param {import('pg').PoolClient|null} [client] - Optional transaction client
 */
async function addCollectable({ userId, shelfId, collectableId, format, notes, rating, position }, client = null) {
    const q = resolveQuery(client);
    const result = await q(
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
 * @param {object} params
 * @param {import('pg').PoolClient|null} [client] - Optional transaction client; if provided the
 *   caller owns the transaction and no new transaction is started internally.
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
    marketValue,
    marketValueSources,
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
}, client = null) {
    const runWithClient = async (c) => {
        let manual = null;
        try {
            const manualResult = await c.query(
                `INSERT INTO user_manuals (
        user_id, shelf_id, name, type, description, author, publisher, manufacturer, format, year, market_value, market_value_sources,
        age_statement, special_markings, label_color, regional_item, edition, barcode, manual_fingerprint, tags,
        limited_edition, item_specific_text
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
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
                    marketValue || null,
                    JSON.stringify(Array.isArray(marketValueSources) ? marketValueSources : []),
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
            manual = manualResult.rows[0];
        } catch (err) {
            const uniqueFingerprintConflict = err?.code === '23505' && manualFingerprint;
            if (!uniqueFingerprintConflict) {
                throw err;
            }
            const existingResult = await c.query(
                `SELECT * FROM user_manuals
                 WHERE user_id = $1 AND shelf_id = $2 AND manual_fingerprint = $3
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1`,
                [userId, shelfId, manualFingerprint],
            );
            if (!existingResult.rows[0]) {
                throw err;
            }
            manual = existingResult.rows[0];
        }

        const collection = await addManualCollection({
            userId,
            shelfId,
            manualId: manual.id,
        }, c);

        return {
            collection,
            manual: rowToCamelCase(manual),
        };
    };

    // If a client is provided by the caller, reuse it (caller owns the transaction).
    // Otherwise start a new transaction to keep the two inserts atomic.
    if (client) {
        return runWithClient(client);
    }
    return transaction(runWithClient);
}

async function findManualByFingerprint({ userId, shelfId, manualFingerprint }) {
    if (!manualFingerprint) return null;
    const result = await query(
        `SELECT * FROM user_manuals
     WHERE user_id = $1 AND shelf_id = $2 AND manual_fingerprint = $3
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
        [userId, shelfId, manualFingerprint]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function findManualByBarcode({ userId, shelfId, barcode }) {
    const normalizedBarcode = normalizeBarcodeToken(barcode);
    if (!normalizedBarcode) return null;
    const result = await query(
        `SELECT * FROM user_manuals
         WHERE user_id = $1
           AND shelf_id = $2
           AND barcode IS NOT NULL
           AND regexp_replace(upper(barcode), '[^A-Z0-9]+', '', 'g') = $3
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [userId, shelfId, normalizedBarcode],
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function fuzzyFindManualForOther({
    userId,
    shelfId,
    canonicalTitle,
    canonicalCreator,
    minCombinedSim = 0.82,
}) {
    const title = normalizeManualFuzzyToken(canonicalTitle);
    const creator = normalizeManualFuzzyToken(canonicalCreator);
    if (!title || !creator) return null;

    const result = await query(
        `SELECT um.*,
                similarity(regexp_replace(lower(COALESCE(um.name, '')), '[^a-z0-9]+', ' ', 'g'), $3) AS title_sim,
                similarity(regexp_replace(lower(COALESCE(um.author, '')), '[^a-z0-9]+', ' ', 'g'), $4) AS creator_sim,
                (
                  similarity(regexp_replace(lower(COALESCE(um.name, '')), '[^a-z0-9]+', ' ', 'g'), $3) * 0.7 +
                  similarity(regexp_replace(lower(COALESCE(um.author, '')), '[^a-z0-9]+', ' ', 'g'), $4) * 0.3
                ) AS combined_sim
         FROM user_manuals um
         WHERE um.user_id = $1
           AND um.shelf_id = $2
           AND similarity(regexp_replace(lower(COALESCE(um.name, '')), '[^a-z0-9]+', ' ', 'g'), $3) >= 0.4
         ORDER BY combined_sim DESC, um.created_at ASC, um.id ASC
         LIMIT 1`,
        [userId, shelfId, title, creator],
    );

    if (!result.rows[0]) return null;
    const candidate = rowToCamelCase(result.rows[0]);
    candidate.titleSim = toSimilarityNumber(candidate.titleSim);
    candidate.creatorSim = toSimilarityNumber(candidate.creatorSim);
    candidate.combinedSim = toSimilarityNumber(candidate.combinedSim);
    if (candidate.combinedSim < minCombinedSim) {
        return null;
    }
    return candidate;
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

async function addManualCollection({ userId, shelfId, manualId }, client = null) {
    const q = resolveQuery(client);
    try {
        const result = await q(
            `INSERT INTO user_collections (user_id, shelf_id, manual_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, shelf_id, manual_id) WHERE manual_id IS NOT NULL
             DO UPDATE SET manual_id = EXCLUDED.manual_id
             RETURNING *`,
            [userId, shelfId, manualId],
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    } catch (err) {
        // Fallback for environments that haven't applied the manual unique index yet.
        if (err?.code !== '42P10' && err?.code !== '23505') {
            throw err;
        }
    }

    const existing = await q(
        `SELECT * FROM user_collections
         WHERE user_id = $1 AND shelf_id = $2 AND manual_id = $3
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [userId, shelfId, manualId],
    );
    if (existing.rows[0]) {
        return rowToCamelCase(existing.rows[0]);
    }

    const inserted = await q(
        `INSERT INTO user_collections (user_id, shelf_id, manual_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, shelfId, manualId],
    );
    return inserted.rows[0] ? rowToCamelCase(inserted.rows[0]) : null;
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

    // Check if owner is suspended - return empty if viewing someone else's suspended profile
    const ownerResult = await query(
        'SELECT is_suspended FROM users WHERE id = $1',
        [ownerId]
    );
    if (ownerResult.rows[0]?.is_suspended) {
        return [];
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
            c.market_value as collectable_market_value,
            c.cover_url as collectable_cover,
            c.cover_image_url as collectable_cover_image_url,
            c.cover_image_source as collectable_cover_image_source,
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

/**
 * Get a manual item by ID
 */
async function getManualById(manualId) {
    const result = await query(
        `SELECT * FROM user_manuals WHERE id = $1`,
        [manualId]
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
    findManualByBarcode,
    fuzzyFindManualForOther,
    findManualCollection,
    addManualCollection,
    removeItem,
    listVisibleForUser,
    updateItemRating,
    getItemById,
    getManualById,
};
