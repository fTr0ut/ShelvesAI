/**
 * User Favorites database queries
 */

const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * List all favorites for a user with collectable details
 */
async function listForUser(userId) {
    const result = await query(
        `SELECT uf.*,
            c.id as collectable_id,
            c.title as collectable_title,
            c.subtitle as collectable_subtitle,
            c.primary_creator as collectable_creator,
            c.cover_url as collectable_cover,
            c.cover_image_url as collectable_cover_image_url,
            c.cover_image_source as collectable_cover_image_source,
            c.attribution as collectable_attribution,
            c.kind as collectable_kind,
            c.year as collectable_year,
            c.system_name as collectable_system_name,
            c.formats as collectable_formats,
            m.local_path as collectable_cover_media_path
         FROM user_favorites uf
         LEFT JOIN collectables c ON c.id = uf.collectable_id
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE uf.user_id = $1
         ORDER BY uf.created_at DESC`,
        [userId]
    );
    return result.rows.map(row => {
        const base = rowToCamelCase(row);
        return {
            id: base.id,
            userId: base.userId,
            createdAt: base.createdAt,
            collectable: {
                id: base.collectableId,
                title: base.collectableTitle,
                subtitle: base.collectableSubtitle,
                primaryCreator: base.collectableCreator,
                coverUrl: base.collectableCover,
                coverImageUrl: base.collectableCoverImageUrl || null,
                coverImageSource: base.collectableCoverImageSource || null,
                attribution: base.collectableAttribution || null,
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
 * Check if a collectable is favorited by user
 */
async function isFavorite(userId, collectableId) {
    const result = await query(
        `SELECT 1 FROM user_favorites WHERE user_id = $1 AND collectable_id = $2`,
        [userId, collectableId]
    );
    return result.rows.length > 0;
}

/**
 * Add a collectable to user's favorites
 */
async function addFavorite(userId, collectableId) {
    const result = await query(
        `INSERT INTO user_favorites (user_id, collectable_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, collectable_id) DO NOTHING
         RETURNING *`,
        [userId, collectableId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Remove a collectable from user's favorites
 */
async function removeFavorite(userId, collectableId) {
    const result = await query(
        `DELETE FROM user_favorites 
         WHERE user_id = $1 AND collectable_id = $2
         RETURNING id`,
        [userId, collectableId]
    );
    return result.rowCount > 0;
}

/**
 * Get count of users who have favorited a collectable
 */
async function getFavoriteCount(collectableId) {
    const result = await query(
        `SELECT COUNT(*) as count FROM user_favorites WHERE collectable_id = $1`,
        [collectableId]
    );
    return parseInt(result.rows[0]?.count || 0);
}

/**
 * Get multiple favorites status for a user (batch check)
 */
async function getFavoritesStatus(userId, collectableIds) {
    if (!collectableIds || collectableIds.length === 0) {
        return {};
    }
    const result = await query(
        `SELECT collectable_id FROM user_favorites 
         WHERE user_id = $1 AND collectable_id = ANY($2)`,
        [userId, collectableIds]
    );
    const favorited = new Set(result.rows.map(r => r.collectable_id));
    const status = {};
    for (const id of collectableIds) {
        status[id] = favorited.has(id);
    }
    return status;
}

module.exports = {
    listForUser,
    isFavorite,
    addFavorite,
    removeFavorite,
    getFavoriteCount,
    getFavoritesStatus,
};
