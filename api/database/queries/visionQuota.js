const { query } = require('../pg');

const DEFAULT_MONTHLY_QUOTA = 50;

function getMonthlyQuota() {
    const raw = parseInt(process.env.VISION_MONTHLY_QUOTA || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_QUOTA;
}

/**
 * Get the current quota status for a user.
 * Automatically resets the period if more than 30 days have passed.
 * @param {string} userId - User ID
 * @returns {Promise<{scansUsed: number, scansRemaining: number, monthlyLimit: number, periodStart: string, daysRemaining: number}>}
 */
async function getQuota(userId) {
    const monthlyLimit = getMonthlyQuota();

    // Try to get existing quota record
    const result = await query(
        `SELECT user_id, scans_used, period_start, created_at, updated_at
         FROM user_vision_quota
         WHERE user_id = $1`,
        [userId]
    );

    if (result.rows.length === 0) {
        // No quota record exists yet, return fresh quota
        return {
            scansUsed: 0,
            scansRemaining: monthlyLimit,
            monthlyLimit,
            periodStart: new Date().toISOString(),
            daysRemaining: 30,
        };
    }

    const row = result.rows[0];
    const periodStart = new Date(row.period_start);
    const now = new Date();
    const daysSincePeriodStart = Math.floor((now - periodStart) / (1000 * 60 * 60 * 24));

    // Check if period has expired (30+ days)
    if (daysSincePeriodStart >= 30) {
        // Reset the period
        await query(
            `UPDATE user_vision_quota
             SET scans_used = 0, period_start = NOW(), updated_at = NOW()
             WHERE user_id = $1`,
            [userId]
        );

        return {
            scansUsed: 0,
            scansRemaining: monthlyLimit,
            monthlyLimit,
            periodStart: now.toISOString(),
            daysRemaining: 30,
        };
    }

    const scansUsed = row.scans_used;
    const scansRemaining = Math.max(0, monthlyLimit - scansUsed);
    const daysRemaining = Math.max(0, 30 - daysSincePeriodStart);

    return {
        scansUsed,
        scansRemaining,
        monthlyLimit,
        periodStart: periodStart.toISOString(),
        daysRemaining,
    };
}

/**
 * Increment the scan usage for a user.
 * Creates a quota record if one doesn't exist.
 * Resets the period if expired before incrementing.
 * @param {string} userId - User ID
 * @returns {Promise<{scansUsed: number, scansRemaining: number, monthlyLimit: number}>}
 */
async function incrementUsage(userId) {
    const monthlyLimit = getMonthlyQuota();

    // Use upsert with period reset logic
    const result = await query(
        `INSERT INTO user_vision_quota (user_id, scans_used, period_start, created_at, updated_at)
         VALUES ($1, 1, NOW(), NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
             scans_used = CASE
                 WHEN user_vision_quota.period_start < NOW() - INTERVAL '30 days'
                 THEN 1
                 ELSE user_vision_quota.scans_used + 1
             END,
             period_start = CASE
                 WHEN user_vision_quota.period_start < NOW() - INTERVAL '30 days'
                 THEN NOW()
                 ELSE user_vision_quota.period_start
             END,
             updated_at = NOW()
         RETURNING scans_used, period_start`,
        [userId]
    );

    const scansUsed = result.rows[0].scans_used;
    const scansRemaining = Math.max(0, monthlyLimit - scansUsed);

    return {
        scansUsed,
        scansRemaining,
        monthlyLimit,
    };
}

/**
 * Reset the quota period for a user (for admin/testing purposes).
 * @param {string} userId - User ID
 */
async function resetQuota(userId) {
    await query(
        `UPDATE user_vision_quota
         SET scans_used = 0, period_start = NOW(), updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
    );
}

module.exports = {
    getQuota,
    incrementUsage,
    resetQuota,
    getMonthlyQuota,
};
