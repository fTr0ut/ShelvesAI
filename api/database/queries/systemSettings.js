const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * Get a single system setting by key.
 * @param {string} key
 * @returns {Promise<{ key: string, value: any, description: string|null, updatedBy: string|null, createdAt: Date, updatedAt: Date }|null>}
 */
async function getSetting(key) {
    const result = await query(
        `SELECT * FROM system_settings WHERE key = $1`,
        [key]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Insert or update a system setting.
 * @param {string} key
 * @param {any} value - Will be stored as JSONB
 * @param {{ description?: string, updatedBy?: string }} [options]
 * @returns {Promise<{ key: string, value: any, description: string|null, updatedBy: string|null, createdAt: Date, updatedAt: Date }>}
 */
async function upsertSetting(key, value, { description = null, updatedBy = null } = {}) {
    const result = await query(
        `INSERT INTO system_settings (key, value, description, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           description = EXCLUDED.description,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
         RETURNING *`,
        [key, JSON.stringify(value), description, updatedBy]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Delete a system setting by key.
 * @param {string} key
 * @returns {Promise<boolean>} true if a row was deleted, false if not found
 */
async function deleteSetting(key) {
    const result = await query(
        `DELETE FROM system_settings WHERE key = $1`,
        [key]
    );
    return result.rowCount > 0;
}

/**
 * Get all system settings.
 * @returns {Promise<Array<{ key: string, value: any, description: string|null, updatedBy: string|null, createdAt: Date, updatedAt: Date }>>}
 */
async function getAllSettings() {
    const result = await query(
        `SELECT * FROM system_settings ORDER BY key ASC`,
        []
    );
    return result.rows.map(rowToCamelCase);
}

module.exports = {
    getSetting,
    upsertSetting,
    deleteSetting,
    getAllSettings,
};
