const { query } = require('../pg');

const DEFAULT_MONTHLY_QUOTA = 15;
const DEFAULT_MONTHLY_TOKEN_QUOTA = 500000;
const DEFAULT_MAX_OUTPUT_TOKENS = 100000;

function getMonthlyQuota() {
    const raw = parseInt(process.env.VISION_MONTHLY_QUOTA || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_QUOTA;
}

function getMonthlyTokenQuota() {
    const raw = parseInt(process.env.VISION_MONTHLY_TOKEN_QUOTA || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_TOKEN_QUOTA;
}

function getMaxOutputTokens() {
    const raw = parseInt(process.env.VISION_MAX_OUTPUT_TOKENS_PER_USER || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Get the current quota status for a user.
 * Automatically resets the period if more than 30 days have passed.
 * @param {string} userId - User ID
 * @returns {Promise<object>}
 */
async function getQuota(userId) {
    const monthlyLimit = getMonthlyQuota();
    const tokenLimit = getMonthlyTokenQuota();
    const outputTokenLimit = getMaxOutputTokens();

    // Try to get existing quota record
    const result = await query(
        `SELECT user_id, scans_used, tokens_used, output_tokens_used, period_start, created_at, updated_at
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
            tokensUsed: 0,
            outputTokensUsed: 0,
            tokenLimit,
            outputTokenLimit,
            tokensRemaining: tokenLimit,
            percentUsed: 0,
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
             SET scans_used = 0, tokens_used = 0, output_tokens_used = 0,
                 period_start = NOW(), updated_at = NOW()
             WHERE user_id = $1`,
            [userId]
        );

        return {
            scansUsed: 0,
            scansRemaining: monthlyLimit,
            monthlyLimit,
            tokensUsed: 0,
            outputTokensUsed: 0,
            tokenLimit,
            outputTokenLimit,
            tokensRemaining: tokenLimit,
            percentUsed: 0,
            periodStart: now.toISOString(),
            daysRemaining: 30,
        };
    }

    const scansUsed = row.scans_used;
    const scansRemaining = Math.max(0, monthlyLimit - scansUsed);
    const daysRemaining = Math.max(0, 30 - daysSincePeriodStart);
    const tokensUsed = Number(row.tokens_used) || 0;
    const outputTokensUsed = Number(row.output_tokens_used) || 0;
    const tokensRemaining = Math.max(0, tokenLimit - tokensUsed);
    const percentUsed = Math.min(100, Math.round((tokensUsed / tokenLimit) * 100));

    return {
        scansUsed,
        scansRemaining,
        monthlyLimit,
        tokensUsed,
        outputTokensUsed,
        tokenLimit,
        outputTokenLimit,
        tokensRemaining,
        percentUsed,
        periodStart: periodStart.toISOString(),
        daysRemaining,
    };
}

/**
 * Increment the scan usage for a user (legacy counter).
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
 * Increment token usage for a user. Also increments scans_used for legacy tracking.
 * Creates a quota record if one doesn't exist.
 * Resets the period if expired before incrementing.
 * @param {string} userId - User ID
 * @param {number} totalTokens - Total tokens consumed
 * @param {number} outputTokens - Output (candidates) tokens consumed
 * @returns {Promise<object>}
 */
async function incrementTokenUsage(userId, totalTokens, outputTokens) {
    const tokenLimit = getMonthlyTokenQuota();
    const outputTokenLimit = getMaxOutputTokens();
    const safeTotal = Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : 0;
    const safeOutput = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;

    const result = await query(
        `INSERT INTO user_vision_quota (user_id, scans_used, tokens_used, output_tokens_used, period_start, created_at, updated_at)
         VALUES ($1, 1, $2, $3, NOW(), NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
             scans_used = CASE
                 WHEN user_vision_quota.period_start < NOW() - INTERVAL '30 days'
                 THEN 1
                 ELSE user_vision_quota.scans_used + 1
             END,
             tokens_used = CASE
                 WHEN user_vision_quota.period_start < NOW() - INTERVAL '30 days'
                 THEN $2
                 ELSE user_vision_quota.tokens_used + $2
             END,
             output_tokens_used = CASE
                 WHEN user_vision_quota.period_start < NOW() - INTERVAL '30 days'
                 THEN $3
                 ELSE user_vision_quota.output_tokens_used + $3
             END,
             period_start = CASE
                 WHEN user_vision_quota.period_start < NOW() - INTERVAL '30 days'
                 THEN NOW()
                 ELSE user_vision_quota.period_start
             END,
             updated_at = NOW()
         RETURNING scans_used, tokens_used, output_tokens_used, period_start`,
        [userId, safeTotal, safeOutput]
    );

    const row = result.rows[0];
    const tokensUsed = Number(row.tokens_used) || 0;

    return {
        scansUsed: row.scans_used,
        tokensUsed,
        outputTokensUsed: Number(row.output_tokens_used) || 0,
        tokensRemaining: Math.max(0, tokenLimit - tokensUsed),
        tokenLimit,
        outputTokenLimit,
    };
}

/**
 * Log aggregated token usage for a job (one row per job).
 * @param {string} userId
 * @param {string} jobId
 * @param {Array<{label: string, promptTokens: number, candidatesTokens: number, totalTokens: number}>} calls
 */
async function logTokenCalls(userId, jobId, calls) {
    if (!Array.isArray(calls) || calls.length === 0) return;

    const totals = calls.reduce((acc, call) => {
        if (!call || typeof call !== 'object') return acc;
        acc.promptTokens += Number(call.promptTokens) || 0;
        acc.candidatesTokens += Number(call.candidatesTokens) || 0;
        acc.totalTokens += Number(call.totalTokens) || 0;
        return acc;
    }, {
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
    });

    await query(
        `INSERT INTO vision_token_log (user_id, job_id, call_label, prompt_tokens, candidates_tokens, total_tokens)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, jobId, 'job_total', totals.promptTokens, totals.candidatesTokens, totals.totalTokens]
    );
}

/**
 * Reset the quota period for a user (for admin/testing purposes).
 * @param {string} userId - User ID
 */
async function resetQuota(userId) {
    await query(
        `UPDATE user_vision_quota
         SET scans_used = 0, tokens_used = 0, output_tokens_used = 0,
             period_start = NOW(), updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
    );
}

/**
 * Set quota values for a user (for admin override).
 * @param {string} userId - User ID
 * @param {number} scansUsed - New scans_used value
 * @param {object} [tokenOverrides] - Optional token overrides
 * @param {number} [tokenOverrides.tokensUsed] - New tokens_used value
 * @param {number} [tokenOverrides.outputTokensUsed] - New output_tokens_used value
 */
async function setQuota(userId, scansUsed, tokenOverrides = {}) {
    const tokensUsed = Number.isFinite(tokenOverrides.tokensUsed) ? tokenOverrides.tokensUsed : null;
    const outputTokensUsed = Number.isFinite(tokenOverrides.outputTokensUsed) ? tokenOverrides.outputTokensUsed : null;
    let tokensUsedParam = null;
    let outputTokensUsedParam = null;

    const setClauses = ['scans_used = $2', 'updated_at = NOW()'];
    const params = [userId, scansUsed];
    let paramIndex = 3;

    if (tokensUsed !== null) {
        tokensUsedParam = paramIndex;
        setClauses.push(`tokens_used = $${paramIndex}`);
        params.push(tokensUsed);
        paramIndex++;
    }
    if (outputTokensUsed !== null) {
        outputTokensUsedParam = paramIndex;
        setClauses.push(`output_tokens_used = $${paramIndex}`);
        params.push(outputTokensUsed);
        paramIndex++;
    }

    const insertColumns = ['user_id', 'scans_used', 'period_start', 'created_at', 'updated_at'];
    const insertValues = ['$1', '$2', 'NOW()', 'NOW()', 'NOW()'];

    if (tokensUsed !== null) {
        insertColumns.push('tokens_used');
        insertValues.push(`$${tokensUsedParam}`);
    }
    if (outputTokensUsed !== null) {
        insertColumns.push('output_tokens_used');
        insertValues.push(`$${outputTokensUsedParam}`);
    }

    await query(
        `INSERT INTO user_vision_quota (${insertColumns.join(', ')})
         VALUES (${insertValues.join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET
           ${setClauses.join(', ')}`,
        params
    );
}

/**
 * Get the monthly quota limit, checking system_settings first.
 * @returns {Promise<number>}
 */
async function getMonthlyQuotaAsync() {
    try {
        const { getSystemSettingsCache } = require('../../services/config/SystemSettingsCache');
        const cached = await getSystemSettingsCache().get('vision_monthly_quota');
        if (cached !== null && Number.isFinite(cached) && cached > 0) {
            return cached;
        }
    } catch (_) {
        // Fall through to env/default
    }
    return getMonthlyQuota();
}

module.exports = {
    getQuota,
    incrementUsage,
    incrementTokenUsage,
    logTokenCalls,
    resetQuota,
    setQuota,
    getMonthlyQuota,
    getMonthlyQuotaAsync,
    getMonthlyTokenQuota,
    getMaxOutputTokens,
};
