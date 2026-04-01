const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

function normalizeTtlHours(value, fallback = 24) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, 24 * 14);
}

async function getValid({ userId, shelfId, imageSha256 }) {
    if (!userId || !shelfId || !imageSha256) return null;

    await query(
        `DELETE FROM vision_result_cache
         WHERE user_id = $1
           AND shelf_id = $2
           AND image_sha256 = $3
           AND expires_at <= NOW()`,
        [userId, shelfId, imageSha256],
    );

    const result = await query(
        `SELECT *
         FROM vision_result_cache
         WHERE user_id = $1
           AND shelf_id = $2
           AND image_sha256 = $3
           AND expires_at > NOW()
         LIMIT 1`,
        [userId, shelfId, imageSha256],
    );

    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function set({
    userId,
    shelfId,
    imageSha256,
    resultJson,
    ttlHours = process.env.VISION_IMAGE_CACHE_TTL_HOURS || 24,
}) {
    if (!userId || !shelfId || !imageSha256 || !resultJson) return null;
    const ttl = normalizeTtlHours(ttlHours, 24);

    const result = await query(
        `INSERT INTO vision_result_cache (
            user_id,
            shelf_id,
            image_sha256,
            result_json,
            created_at,
            expires_at
         )
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW() + ($5::int * INTERVAL '1 hour'))
         ON CONFLICT (user_id, shelf_id, image_sha256)
         DO UPDATE
         SET result_json = EXCLUDED.result_json,
             created_at = NOW(),
             expires_at = EXCLUDED.expires_at
         RETURNING *`,
        [userId, shelfId, imageSha256, JSON.stringify(resultJson), ttl],
    );

    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function deleteByHash({ userId, shelfId, imageSha256 }) {
    if (!userId || !shelfId || !imageSha256) return 0;
    const result = await query(
        `DELETE FROM vision_result_cache
         WHERE user_id = $1
           AND shelf_id = $2
           AND image_sha256 = $3`,
        [userId, shelfId, imageSha256],
    );
    return Number(result.rowCount || 0);
}

module.exports = {
    getValid,
    set,
    deleteByHash,
};
