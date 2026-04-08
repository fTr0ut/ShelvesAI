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
const {
    normalizeSearchText,
    buildNormalizedSqlExpression,
} = require('../../utils/searchNormalization');

const normalizedCollectableTitleExpr = buildNormalizedSqlExpression('c.title');
const normalizedCollectableCreatorExpr = buildNormalizedSqlExpression('COALESCE(c.primary_creator, \'\')');
const normalizedManualTitleExpr = buildNormalizedSqlExpression('um.name');
const normalizedManualCreatorExpr = buildNormalizedSqlExpression('COALESCE(um.author, \'\')');
const normalizedShelfNameExpr = buildNormalizedSqlExpression('s.name');

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

function normalizeOwnedPlatforms(input) {
    if (input == null) return [];
    const source = Array.isArray(input) ? input : [input];
    const seen = new Set();
    const out = [];
    for (const entry of source) {
        const normalized = String(entry ?? '').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
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
        `SELECT s.*, u.username AS owner_username FROM shelves s
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
async function create({
    userId,
    name,
    type,
    description,
    visibility = 'private',
    gameDefaults = null,
}) {
    const result = await query(
        `INSERT INTO shelves (owner_id, name, type, description, visibility, game_defaults)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
        [userId, name, type, description, visibility, gameDefaults ? JSON.stringify(gameDefaults) : null]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Update a shelf
 */
async function update(shelfId, userId, updates, client = null) {
    const q = resolveQuery(client);
    const allowedFields = ['name', 'description', 'visibility', 'game_defaults'];
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            if (key === 'game_defaults') {
                fields.push(`${key} = $${paramIndex}::jsonb`);
                values.push(value ? JSON.stringify(value) : null);
            } else {
                fields.push(`${key} = $${paramIndex}`);
                values.push(value);
            }
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return getById(shelfId, userId);
    }

    values.push(shelfId, userId);
    const result = await q(
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
            uc.position, uc.format, uc.platform_missing, uc.notes, uc.created_at,
            uc.reviewed_event_log_id, uc.reviewed_event_published_at, uc.reviewed_event_updated_at,
            EXISTS (
                SELECT 1
                FROM vision_item_regions vir
                WHERE vir.collection_item_id = uc.id
            ) AS is_vision_linked,
            uc.owner_photo_source, uc.owner_photo_crop_id, uc.owner_photo_content_type,
            uc.owner_photo_size_bytes, uc.owner_photo_width, uc.owner_photo_height,
            uc.owner_photo_thumb_storage_provider, uc.owner_photo_thumb_storage_key,
            uc.owner_photo_thumb_content_type, uc.owner_photo_thumb_size_bytes,
            uc.owner_photo_thumb_width, uc.owner_photo_thumb_height,
            uc.owner_photo_thumb_box, uc.owner_photo_thumb_updated_at,
            uc.owner_photo_visible, uc.owner_photo_updated_at,
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
            c.platform_data as collectable_platform_data,
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
            COALESCE(ucp.platform_names, ARRAY[]::text[]) as owned_platforms,
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
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(DISTINCT ucp.platform_name ORDER BY ucp.platform_name) AS platform_names
       FROM user_collection_platforms ucp
       WHERE ucp.collection_item_id = uc.id
     ) ucp ON TRUE
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
            uc.position, uc.format, uc.platform_missing, uc.notes, uc.created_at,
            uc.reviewed_event_log_id, uc.reviewed_event_published_at, uc.reviewed_event_updated_at,
            EXISTS (
                SELECT 1
                FROM vision_item_regions vir
                WHERE vir.collection_item_id = uc.id
            ) AS is_vision_linked,
            uc.owner_photo_source, uc.owner_photo_crop_id, uc.owner_photo_content_type,
            uc.owner_photo_size_bytes, uc.owner_photo_width, uc.owner_photo_height,
            uc.owner_photo_thumb_storage_provider, uc.owner_photo_thumb_storage_key,
            uc.owner_photo_thumb_content_type, uc.owner_photo_thumb_size_bytes,
            uc.owner_photo_thumb_width, uc.owner_photo_thumb_height,
            uc.owner_photo_thumb_box, uc.owner_photo_thumb_updated_at,
            uc.owner_photo_visible, uc.owner_photo_updated_at,
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
            c.platform_data as collectable_platform_data,
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
            COALESCE(ucp.platform_names, ARRAY[]::text[]) as owned_platforms,
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
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(DISTINCT ucp.platform_name ORDER BY ucp.platform_name) AS platform_names
       FROM user_collection_platforms ucp
       WHERE ucp.collection_item_id = uc.id
     ) ucp ON TRUE
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
async function addCollectable({
    userId,
    shelfId,
    collectableId,
    format,
    platformMissing,
    notes,
    rating,
    position,
}, client = null) {
    const q = resolveQuery(client);
    const hasPlatformMissing = platformMissing === true || platformMissing === false;
    const platformMissingValue = hasPlatformMissing ? platformMissing : false;
    const hasUpdatableFields = (
        format !== undefined && format !== null
    ) || (
        hasPlatformMissing
    ) || (
        notes !== undefined && notes !== null
    ) || (
        rating !== undefined && rating !== null
    );

    if (!hasUpdatableFields) {
        const inserted = await q(
            `INSERT INTO user_collections (user_id, shelf_id, collectable_id, format, platform_missing, notes, rating, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, shelf_id, collectable_id) DO NOTHING
         RETURNING *`,
            [userId, shelfId, collectableId, format, platformMissingValue, notes, rating, position]
        );
        if (inserted.rows[0]) {
            return rowToCamelCase(inserted.rows[0]);
        }

        const existing = await q(
            `SELECT *
             FROM user_collections
             WHERE user_id = $1 AND shelf_id = $2 AND collectable_id = $3
             ORDER BY created_at ASC, id ASC
             LIMIT 1`,
            [userId, shelfId, collectableId],
        );
        return existing.rows[0] ? rowToCamelCase(existing.rows[0]) : null;
    }

    const result = await q(
        `INSERT INTO user_collections (user_id, shelf_id, collectable_id, format, platform_missing, notes, rating, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, shelf_id, collectable_id) DO UPDATE
     SET format = COALESCE(EXCLUDED.format, user_collections.format),
         platform_missing = CASE
             WHEN $9::boolean THEN EXCLUDED.platform_missing
             ELSE user_collections.platform_missing
         END,
         notes = COALESCE(EXCLUDED.notes, user_collections.notes),
         rating = COALESCE(EXCLUDED.rating, user_collections.rating)
     RETURNING *`,
        [userId, shelfId, collectableId, format, platformMissingValue, notes, rating, position, hasPlatformMissing]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
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
             DO NOTHING
             RETURNING *`,
            [userId, shelfId, manualId],
        );
        if (result.rows[0]) {
            return rowToCamelCase(result.rows[0]);
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

async function findCollectionByReference({ userId, shelfId, collectableId = null, manualId = null }) {
    if (!userId || !shelfId) return null;
    if (!collectableId && !manualId) return null;

    const filters = ['user_id = $1', 'shelf_id = $2'];
    const params = [userId, shelfId];
    if (collectableId) {
        params.push(collectableId);
        filters.push(`collectable_id = $${params.length}`);
    }
    if (manualId) {
        params.push(manualId);
        filters.push(`manual_id = $${params.length}`);
    }

    const result = await query(
        `SELECT *
         FROM user_collections
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        params,
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function getCollectionItemByIdForShelf(itemId, shelfId) {
    if (!itemId || !shelfId) return null;
    const result = await query(
        `SELECT uc.id, uc.user_id, uc.shelf_id, uc.collectable_id, uc.manual_id,
                uc.owner_photo_source, uc.owner_photo_crop_id, uc.owner_photo_storage_provider,
                uc.owner_photo_storage_key, uc.owner_photo_content_type, uc.owner_photo_size_bytes,
                uc.owner_photo_width, uc.owner_photo_height,
                uc.owner_photo_thumb_storage_provider, uc.owner_photo_thumb_storage_key,
                uc.owner_photo_thumb_content_type, uc.owner_photo_thumb_size_bytes,
                uc.owner_photo_thumb_width, uc.owner_photo_thumb_height,
                uc.owner_photo_thumb_box, uc.owner_photo_thumb_updated_at,
                uc.owner_photo_visible, uc.owner_photo_updated_at,
                u.show_personal_photos
         FROM user_collections uc
         JOIN users u ON u.id = uc.user_id
         WHERE uc.id = $1
           AND uc.shelf_id = $2
         LIMIT 1`,
        [itemId, shelfId],
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Remove an item from a shelf
 */
async function removeItem(itemId, userId, shelfId, client = null) {
    const q = resolveQuery(client);
    const result = await q(
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
 * Update rating/notes for a user collection item.
 * Supports legacy signature where the 4th arg is a rating number/null.
 * @param {number} itemId - The user_collections id
 * @param {string} userId - The user's UUID
 * @param {number} shelfId - The shelf id
 * @param {{rating?: number|null, notes?: string|null}|number|null} updatesOrRating
 */
async function updateItemRating(itemId, userId, shelfId, updatesOrRating) {
    const isObjectPayload = updatesOrRating && typeof updatesOrRating === 'object' && !Array.isArray(updatesOrRating);
    const payload = isObjectPayload ? updatesOrRating : { rating: updatesOrRating };
    const hasRating = Object.prototype.hasOwnProperty.call(payload, 'rating');
    const hasNotes = Object.prototype.hasOwnProperty.call(payload, 'notes');

    if (!hasRating && !hasNotes) {
        return null;
    }

    const existingResult = await query(
        `SELECT id, rating
         FROM user_collections
         WHERE id = $1 AND user_id = $2 AND shelf_id = $3
         LIMIT 1`,
        [itemId, userId, shelfId],
    );
    const existing = existingResult.rows[0] || null;
    if (!existing) {
        return null;
    }

    const setClauses = [];
    const values = [];

    if (hasRating) {
        values.push(payload.rating);
        setClauses.push(`rating = $${values.length}`);
    }
    if (hasNotes) {
        values.push(payload.notes);
        setClauses.push(`notes = $${values.length}`);
    }

    values.push(itemId, userId, shelfId);
    const itemIdParam = values.length - 2;
    const userIdParam = values.length - 1;
    const shelfIdParam = values.length;
    const result = await query(
        `UPDATE user_collections
         SET ${setClauses.join(', ')}
         WHERE id = $${itemIdParam} AND user_id = $${userIdParam} AND shelf_id = $${shelfIdParam}
         RETURNING *`,
        values
    );
    if (!result.rows[0]) {
        return null;
    }
    const updated = rowToCamelCase(result.rows[0]);
    updated.previousRating = existing.rating;
    return updated;
}

async function updateReviewedEventLink(itemId, userId, shelfId, {
    reviewedEventLogId = null,
    reviewedEventPublishedAt = null,
    reviewedEventUpdatedAt = null,
} = {}) {
    const result = await query(
        `UPDATE user_collections
         SET reviewed_event_log_id = $1,
             reviewed_event_published_at = $2,
             reviewed_event_updated_at = $3
         WHERE id = $4
           AND user_id = $5
           AND shelf_id = $6
         RETURNING reviewed_event_log_id, reviewed_event_published_at, reviewed_event_updated_at`,
        [
            reviewedEventLogId,
            reviewedEventPublishedAt,
            reviewedEventUpdatedAt,
            itemId,
            userId,
            shelfId,
        ],
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get a single collection item by ID with full details
 */
async function getItemById(itemId, userId, shelfId) {
    const result = await query(
        `SELECT uc.id, uc.user_id, uc.shelf_id, uc.collectable_id, uc.manual_id,
            uc.position, uc.format, uc.platform_missing, uc.notes, uc.created_at,
            uc.reviewed_event_log_id, uc.reviewed_event_published_at, uc.reviewed_event_updated_at,
            uc.owner_photo_source, uc.owner_photo_crop_id, uc.owner_photo_storage_provider,
            uc.owner_photo_storage_key, uc.owner_photo_content_type, uc.owner_photo_size_bytes,
            uc.owner_photo_width, uc.owner_photo_height,
            uc.owner_photo_thumb_storage_provider, uc.owner_photo_thumb_storage_key,
            uc.owner_photo_thumb_content_type, uc.owner_photo_thumb_size_bytes,
            uc.owner_photo_thumb_width, uc.owner_photo_thumb_height,
            uc.owner_photo_thumb_box, uc.owner_photo_thumb_updated_at,
            uc.owner_photo_visible, uc.owner_photo_updated_at,
            EXISTS (
                SELECT 1
                FROM vision_item_regions vir
                WHERE vir.collection_item_id = uc.id
            ) AS is_vision_linked,
            u.show_personal_photos,
            ur.rating as rating,
            c.id as collectable_id,
            c.title as collectable_title,
            c.subtitle as collectable_subtitle,
            c.description as collectable_description,
            c.primary_creator as collectable_creator,
            c.publishers as collectable_publishers,
            c.year as collectable_year,
            c.market_value as collectable_market_value,
            c.formats as collectable_formats,
            c.system_name as collectable_system_name,
            c.platform_data as collectable_platform_data,
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
            c.kind as collectable_kind,
            COALESCE(ucp.platform_names, ARRAY[]::text[]) as owned_platforms,
            m.local_path as collectable_cover_media_path,
            um.id as manual_id,
            um.name as manual_name,
            um.description as manual_description,
            um.author as manual_author,
            um.manufacturer as manual_manufacturer,
            um.publisher as manual_publisher,
            um.type as manual_type,
            um.format as manual_format,
            um.cover_media_path as manual_cover_media_path,
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
            um.genre as manual_genre
         FROM user_collections uc
         JOIN users u ON u.id = uc.user_id
         LEFT JOIN collectables c ON c.id = uc.collectable_id
         LEFT JOIN media m ON m.id = c.cover_media_id
         LEFT JOIN LATERAL (
            SELECT ARRAY_AGG(DISTINCT ucp.platform_name ORDER BY ucp.platform_name) AS platform_names
            FROM user_collection_platforms ucp
            WHERE ucp.collection_item_id = uc.id
         ) ucp ON TRUE
         LEFT JOIN user_ratings ur ON ur.user_id = uc.user_id
            AND (ur.collectable_id = uc.collectable_id OR ur.manual_id = uc.manual_id)
         LEFT JOIN user_manuals um ON um.id = uc.manual_id
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

async function getOwnedPlatformsByCollectionItemId(collectionItemId, client = null) {
    const q = resolveQuery(client);
    const result = await q(
        `SELECT platform_name
         FROM user_collection_platforms
         WHERE collection_item_id = $1
         ORDER BY platform_name ASC`,
        [collectionItemId],
    );
    return result.rows
        .map((row) => String(row.platform_name || '').trim())
        .filter(Boolean);
}

async function replaceOwnedPlatformsForCollectionItem({
    collectionItemId,
    userId,
    shelfId,
    platforms,
}, client = null) {
    const q = resolveQuery(client);
    const normalizedPlatforms = normalizeOwnedPlatforms(platforms);

    const ownership = await q(
        `SELECT id
         FROM user_collections
         WHERE id = $1 AND user_id = $2 AND shelf_id = $3
         LIMIT 1`,
        [collectionItemId, userId, shelfId],
    );
    if (!ownership.rows[0]) return null;

    await q(
        `DELETE FROM user_collection_platforms WHERE collection_item_id = $1`,
        [collectionItemId],
    );

    if (normalizedPlatforms.length) {
        await q(
            `INSERT INTO user_collection_platforms (collection_item_id, platform_name)
             SELECT $1, platform_name
             FROM UNNEST($2::text[]) AS platform_name
             ON CONFLICT DO NOTHING`,
            [collectionItemId, normalizedPlatforms],
        );
    }

    return getOwnedPlatformsByCollectionItemId(collectionItemId, client);
}

async function ensureOwnedPlatformsForCollectionItem({
    collectionItemId,
    platforms,
}, client = null) {
    const q = resolveQuery(client);
    const normalizedPlatforms = normalizeOwnedPlatforms(platforms);
    if (!collectionItemId || !normalizedPlatforms.length) {
        return [];
    }

    await q(
        `INSERT INTO user_collection_platforms (collection_item_id, platform_name)
         SELECT $1, platform_name
         FROM UNNEST($2::text[]) AS platform_name
         ON CONFLICT DO NOTHING`,
        [collectionItemId, normalizedPlatforms],
    );

    return getOwnedPlatformsByCollectionItemId(collectionItemId, client);
}

async function updateCollectionItemGameDefaults({
    collectionItemId,
    userId,
    shelfId,
    format = null,
    platformMissing = false,
}, client = null) {
    const q = resolveQuery(client);
    const result = await q(
        `UPDATE user_collections
         SET format = $1,
             platform_missing = $2
         WHERE id = $3
           AND user_id = $4
           AND shelf_id = $5
         RETURNING *`,
        [format, platformMissing === true, collectionItemId, userId, shelfId],
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function listCollectionItemsForDefaults({ userId, shelfId }, client = null) {
    const q = resolveQuery(client);
    const result = await q(
        `SELECT uc.id,
                uc.user_id,
                uc.shelf_id,
                uc.collectable_id,
                uc.manual_id,
                c.kind AS collectable_kind,
                c.system_name AS collectable_system_name,
                c.platform_data AS collectable_platform_data
         FROM user_collections uc
         LEFT JOIN collectables c ON c.id = uc.collectable_id
         WHERE uc.user_id = $1
           AND uc.shelf_id = $2`,
        [userId, shelfId],
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Search across a user's shelves, collectables, and manual entries
 */
async function searchUserCollection(userId, searchQuery, { limit = 50, offset = 0 } = {}) {
    const q = String(searchQuery || '').trim();
    if (!q) return [];
    
    const normalizedQuery = normalizeSearchText(q);

    const sql = `
        SELECT result_type, id, shelf_id, collectable_id, manual_id, title, subtitle, kind, format, system_name, owned_platforms, shelf_name,
               year, genre, tags, cast_members,
               cover_url, cover_media_path,
               owner_photo_source, owner_photo_thumb_storage_provider, owner_photo_thumb_storage_key,
               owner_photo_thumb_updated_at, is_vision_linked
        FROM (
            SELECT 'shelf' as result_type,
                   s.id as id,
                   NULL::integer as shelf_id,
                   NULL::integer as collectable_id,
                   NULL::integer as manual_id,
                   s.name as title,
                   NULL::text as subtitle,
                   s.type as kind,
                   NULL::text as format,
                   NULL::text as system_name,
                   ARRAY[]::text[] as owned_platforms,
                   NULL::text as shelf_name,
                   NULL::text as year,
                   NULL::text[] as genre,
                   NULL::text[] as tags,
                   NULL::jsonb as cast_members,
                   NULL::text as cover_url,
                   NULL::text as cover_media_path,
                   NULL::text as owner_photo_source,
                   NULL::text as owner_photo_thumb_storage_provider,
                   NULL::text as owner_photo_thumb_storage_key,
                   NULL::timestamp as owner_photo_thumb_updated_at,
                   false as is_vision_linked,
                   GREATEST(
                       similarity(s.name, $1),
                       similarity(${normalizedShelfNameExpr}, $2)
                   ) AS score
            FROM shelves s
            WHERE s.owner_id = $3
              AND (
                  s.name % $1 OR
                  ${normalizedShelfNameExpr} % $2 OR
                  s.name ILIKE '%' || $1 || '%'
              )
            
            UNION ALL
            
            SELECT 'collectable' as result_type,
                   uc.id as id,
                   uc.shelf_id as shelf_id,
                   uc.collectable_id as collectable_id,
                   NULL::integer as manual_id,
                   c.title as title,
                   c.primary_creator as subtitle,
                   c.kind as kind,
                   uc.format as format,
                   c.system_name as system_name,
                   COALESCE((
                     SELECT ARRAY_AGG(DISTINCT ucp.platform_name ORDER BY ucp.platform_name)
                     FROM user_collection_platforms ucp
                     WHERE ucp.collection_item_id = uc.id
                   ), ARRAY[]::text[]) as owned_platforms,
                   s.name as shelf_name,
                   c.year as year,
                   c.genre as genre,
                   c.tags as tags,
                   c.cast_members as cast_members,
                   c.cover_url as cover_url,
                   m.local_path as cover_media_path,
                   uc.owner_photo_source,
                   uc.owner_photo_thumb_storage_provider,
                   uc.owner_photo_thumb_storage_key,
                   uc.owner_photo_thumb_updated_at,
                   EXISTS (
                       SELECT 1 FROM vision_item_regions vir WHERE vir.collection_item_id = uc.id
                   ) AS is_vision_linked,
                   GREATEST(
                       similarity(c.title, $1),
                       similarity(COALESCE(c.primary_creator, ''), $1),
                       similarity(${normalizedCollectableTitleExpr}, $2),
                       similarity(${normalizedCollectableCreatorExpr}, $2)
                   ) AS score
            FROM user_collections uc
            JOIN collectables c ON c.id = uc.collectable_id
            JOIN shelves s ON s.id = uc.shelf_id
            LEFT JOIN media m ON m.id = c.cover_media_id
            WHERE uc.user_id = $3
              AND (
                  c.title % $1 OR
                  c.primary_creator % $1 OR
                  ${normalizedCollectableTitleExpr} % $2 OR
                  ${normalizedCollectableCreatorExpr} % $2 OR
                  c.title ILIKE '%' || $1 || '%' OR
                  c.primary_creator ILIKE '%' || $1 || '%' OR
                  c.year ILIKE '%' || $1 || '%' OR
                  array_to_string(c.genre, ' ') ILIKE '%' || $1 || '%' OR
                  array_to_string(c.tags, ' ') ILIKE '%' || $1 || '%' OR
                  c.system_name ILIKE '%' || $1 || '%' OR
                  EXISTS (
                    SELECT 1
                    FROM user_collection_platforms ucp
                    WHERE ucp.collection_item_id = uc.id
                      AND ucp.platform_name ILIKE '%' || $1 || '%'
                  ) OR
                  c.cast_members::text ILIKE '%' || $1 || '%'
              )
              
            UNION ALL
            
            SELECT 'manual' as result_type,
                   uc.id as id,
                   uc.shelf_id as shelf_id,
                   NULL::integer as collectable_id,
                   uc.manual_id as manual_id,
                   um.name as title,
                   um.author as subtitle,
                   um.type as kind,
                   COALESCE(uc.format, um.format) as format,
                   NULL::text as system_name,
                   ARRAY[]::text[] as owned_platforms,
                   s.name as shelf_name,
                   um.year as year,
                   um.genre as genre,
                   um.tags as tags,
                   NULL::jsonb as cast_members,
                   NULL::text as cover_url,
                   um.cover_media_path as cover_media_path,
                   uc.owner_photo_source,
                   uc.owner_photo_thumb_storage_provider,
                   uc.owner_photo_thumb_storage_key,
                   uc.owner_photo_thumb_updated_at,
                   EXISTS (
                       SELECT 1 FROM vision_item_regions vir WHERE vir.collection_item_id = uc.id
                   ) AS is_vision_linked,
                   GREATEST(
                       similarity(um.name, $1),
                       similarity(COALESCE(um.author, ''), $1),
                       similarity(${normalizedManualTitleExpr}, $2),
                       similarity(${normalizedManualCreatorExpr}, $2)
                   ) AS score
            FROM user_collections uc
            JOIN user_manuals um ON um.id = uc.manual_id
            JOIN shelves s ON s.id = uc.shelf_id
            WHERE uc.user_id = $3
              AND (
                  um.name % $1 OR
                  um.author % $1 OR
                  ${normalizedManualTitleExpr} % $2 OR
                  ${normalizedManualCreatorExpr} % $2 OR
                  um.name ILIKE '%' || $1 || '%' OR
                  um.author ILIKE '%' || $1 || '%' OR
                  um.year ILIKE '%' || $1 || '%' OR
                  array_to_string(um.genre, ' ') ILIKE '%' || $1 || '%' OR
                  array_to_string(um.tags, ' ') ILIKE '%' || $1 || '%'
              )
        ) results
        ORDER BY score DESC NULLS LAST, title ASC
        LIMIT $4 OFFSET $5
    `;

    const result = await query(sql, [q, normalizedQuery, userId, limit, offset]);
    return result.rows.map(rowToCamelCase);
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
    findCollectionByReference,
    getCollectionItemByIdForShelf,
    removeItem,
    listVisibleForUser,
    updateItemRating,
    updateReviewedEventLink,
    getItemById,
    getManualById,
    getOwnedPlatformsByCollectionItemId,
    replaceOwnedPlatformsForCollectionItem,
    ensureOwnedPlatformsForCollectionItem,
    updateCollectionItemGameDefaults,
    listCollectionItemsForDefaults,
    searchUserCollection,
};
