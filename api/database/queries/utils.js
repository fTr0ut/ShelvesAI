/**
 * Database Query Utilities
 * Helper functions for dynamic queries, pagination, and data conversion
 */

/**
 * Convert snake_case to camelCase
 */
function toCamelCase(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case
 */
function toSnakeCase(str) {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert object keys from snake_case to camelCase
 */
function rowToCamelCase(row) {
    if (!row) return null;
    const result = {};
    for (const [key, value] of Object.entries(row)) {
        result[toCamelCase(key)] = value;
    }
    return result;
}

/**
 * Convert object keys from camelCase to snake_case
 */
function objectToSnakeCase(obj) {
    if (!obj) return null;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        result[toSnakeCase(key)] = value;
    }
    return result;
}

/**
 * Build dynamic UPDATE query from object
 * @param {string} table - Table name
 * @param {object} updates - Key-value pairs to update
 * @param {string} whereColumn - Column for WHERE clause
 * @param {any} whereValue - Value for WHERE clause
 * @param {string[]} allowedFields - Whitelist of allowed fields
 * @returns {{ text: string, values: any[] }}
 */
function buildUpdateQuery(table, updates, whereColumn, whereValue, allowedFields = []) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
        const snakeKey = toSnakeCase(key);
        if (allowedFields.length === 0 || allowedFields.includes(snakeKey)) {
            fields.push(`${snakeKey} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }

    if (fields.length === 0) {
        return null;
    }

    values.push(whereValue);
    const text = `UPDATE ${table} SET ${fields.join(', ')} WHERE ${whereColumn} = $${paramIndex} RETURNING *`;

    return { text, values };
}

/**
 * Parse pagination parameters from request query
 */
function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
    let limit = parseInt(query.limit, 10);
    let offset = parseInt(query.offset, 10);

    if (isNaN(limit) || limit < 1) limit = defaultLimit;
    if (isNaN(offset) || offset < 0) offset = 0;
    if (limit > maxLimit) limit = maxLimit;

    return { limit, offset };
}

/**
 * Build ORDER BY clause from sort parameter
 * @param {string} sort - Sort string like "-created_at" or "name"
 * @param {string[]} allowedFields - Whitelist of sortable fields
 * @param {string} defaultSort - Default sort if invalid
 */
function buildOrderBy(sort, allowedFields, defaultSort = 'created_at DESC') {
    if (!sort) return defaultSort;

    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    const snakeField = toSnakeCase(field);

    if (!allowedFields.includes(snakeField)) {
        return defaultSort;
    }

    return `${snakeField} ${desc ? 'DESC' : 'ASC'}`;
}

/**
 * Format user object for API response (hide sensitive fields)
 */
function formatUserForResponse(user) {
    if (!user) return null;
    const { password_hash, ...safe } = user;
    return rowToCamelCase(safe);
}

module.exports = {
    toCamelCase,
    toSnakeCase,
    rowToCamelCase,
    objectToSnakeCase,
    buildUpdateQuery,
    parsePagination,
    buildOrderBy,
    formatUserForResponse,
};
