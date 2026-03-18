const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED_DB_KEYS = [
    ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'],
    ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'],
];

function resolveDbConfig() {
    for (const set of REQUIRED_DB_KEYS) {
        const hasAll = set.every((key) => process.env[key]);
        if (!hasAll) continue;
        if (set[0] === 'DB_HOST') {
            return {
                host: process.env.DB_HOST,
                port: Number(process.env.DB_PORT),
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME,
            };
        }
        return {
            host: process.env.POSTGRES_HOST,
            port: Number(process.env.POSTGRES_PORT),
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            database: process.env.POSTGRES_DB,
        };
    }

    throw new Error('Missing DB_* or POSTGRES_* env vars in api/.env.');
}

function parseArgs() {
    const args = new Set(process.argv.slice(2));
    const tokenArg = [...args].find((arg) => arg.startsWith('--token='));
    const token = tokenArg ? tokenArg.split('=')[1] : '';
    return {
        execute: args.has('--execute'),
        verbose: args.has('--verbose'),
        token,
    };
}

function logSummary(summary) {
    console.log('Cleanup summary (dry run):');
    console.log(`- Target users: ${summary.users}`);
    console.log(`- Notifications to delete: ${summary.notifications}`);
    console.log(`- Event aggregates to delete: ${summary.eventAggregates}`);
    console.log(`- Event logs to delete: ${summary.eventLogs}`);
    console.log(`- Friendships to delete: ${summary.friendships}`);
}

async function main() {
    const { execute, verbose, token } = parseArgs();
    const confirmToken = process.env.NOTIF_CLEANUP_TOKEN;
    const allowExecute = execute && confirmToken && token === confirmToken;

    const pool = new Pool(resolveDbConfig());

    try {
        const targetUsersResult = await pool.query(
            `SELECT id, username, email
             FROM users
             WHERE (username LIKE 'notif_user_a_%' OR username LIKE 'notif_user_b_%')
               AND email = (username || '@example.com')`
        );

        if (!targetUsersResult.rows.length) {
            console.log('No notif_user_* accounts found. Nothing to delete.');
            return;
        }

        const userIds = targetUsersResult.rows.map((row) => row.id);
        const userIdsParam = userIds;

        const notificationCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM notifications
             WHERE user_id = ANY($1::uuid[])
                OR actor_id = ANY($1::uuid[])`,
            [userIdsParam]
        );

        const eventAggregateResult = await pool.query(
            `SELECT id
             FROM event_aggregates
             WHERE user_id = ANY($1::uuid[])`,
            [userIdsParam]
        );
        const eventAggregateIds = eventAggregateResult.rows.map((row) => row.id);

        const eventLogsCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM event_logs
             WHERE user_id = ANY($1::uuid[])`,
            [userIdsParam]
        );

        const friendshipsCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM friendships
             WHERE requester_id = ANY($1::uuid[])
                OR addressee_id = ANY($1::uuid[])`,
            [userIdsParam]
        );

        const summary = {
            users: userIds.length,
            notifications: notificationCount.rows[0]?.count || 0,
            eventAggregates: eventAggregateIds.length,
            eventLogs: eventLogsCount.rows[0]?.count || 0,
            friendships: friendshipsCount.rows[0]?.count || 0,
        };

        if (!allowExecute) {
            logSummary(summary);
            if (verbose) {
                const notificationRows = await pool.query(
                    `SELECT id, user_id, actor_id, type, entity_type, entity_id, is_read, created_at, deleted_at
                     FROM notifications
                     WHERE user_id = ANY($1::uuid[])
                        OR actor_id = ANY($1::uuid[])
                     ORDER BY created_at DESC`,
                    [userIdsParam]
                );
                const eventLogRows = await pool.query(
                    `SELECT id, user_id, event_type, aggregate_id, created_at
                     FROM event_logs
                     WHERE user_id = ANY($1::uuid[])
                     ORDER BY created_at DESC`,
                    [userIdsParam]
                );
                const friendshipRows = await pool.query(
                    `SELECT id, requester_id, addressee_id, status, created_at, updated_at
                     FROM friendships
                     WHERE requester_id = ANY($1::uuid[])
                        OR addressee_id = ANY($1::uuid[])
                     ORDER BY updated_at DESC`,
                    [userIdsParam]
                );

                console.log('');
                console.log('Targets (dry run):');
                console.log('Users:', targetUsersResult.rows);
                console.log('Notifications:', notificationRows.rows);
                console.log('Event aggregates:', eventAggregateIds);
                console.log('Event logs:', eventLogRows.rows);
                console.log('Friendships:', friendshipRows.rows);
            }
            console.log('');
            console.log('To execute:');
            console.log('1) Set NOTIF_CLEANUP_TOKEN in api/.env (any unique string).');
            console.log('2) Run: node api/_tests_/cleanup-notif-users.js --execute --token=YOUR_TOKEN');
            return;
        }

        await pool.query('BEGIN');

        await pool.query(
            `DELETE FROM notifications
             WHERE user_id = ANY($1::uuid[])
                OR actor_id = ANY($1::uuid[])`,
            [userIdsParam]
        );

        if (eventAggregateIds.length) {
            await pool.query(
                `DELETE FROM event_aggregates
                 WHERE id = ANY($1::uuid[])`,
                [eventAggregateIds]
            );
        }

        await pool.query(
            `DELETE FROM event_logs
             WHERE user_id = ANY($1::uuid[])`,
            [userIdsParam]
        );

        await pool.query(
            `DELETE FROM friendships
             WHERE requester_id = ANY($1::uuid[])
                OR addressee_id = ANY($1::uuid[])`,
            [userIdsParam]
        );

        await pool.query(
            `DELETE FROM users
             WHERE id = ANY($1::uuid[])`,
            [userIdsParam]
        );

        await pool.query('COMMIT');
        console.log('Cleanup complete.');
    } catch (err) {
        try {
            await pool.query('ROLLBACK');
        } catch (rollbackErr) {
            console.warn('Rollback failed:', rollbackErr.message);
        }
        console.error('Cleanup failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('Cleanup failed:', err.message);
    process.exitCode = 1;
});
