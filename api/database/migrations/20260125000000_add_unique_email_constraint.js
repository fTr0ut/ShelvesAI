/**
 * Adds UNIQUE constraint on users.email to prevent duplicate accounts.
 * Will fail if duplicate emails exist - must be cleaned up manually first.
 */

exports.up = async function (knex) {
    // First, check for duplicate emails
    const duplicates = await knex.raw(`
        SELECT LOWER(email) as email, COUNT(*) as count
        FROM users
        WHERE email IS NOT NULL
        GROUP BY LOWER(email)
        HAVING COUNT(*) > 1
    `);

    if (duplicates.rows.length > 0) {
        const duplicateList = duplicates.rows
            .map((r) => `${r.email} (${r.count} accounts)`)
            .join(', ');
        throw new Error(
            `Cannot add unique constraint: duplicate emails exist: ${duplicateList}. ` +
                'Please resolve duplicates manually before running this migration.'
        );
    }

    // Normalize all emails to lowercase
    await knex.raw(`
        UPDATE users
        SET email = LOWER(TRIM(email))
        WHERE email IS NOT NULL
    `);

    // Add unique constraint
    await knex.raw(`
        ALTER TABLE users
        ADD CONSTRAINT users_email_unique UNIQUE (email)
    `);
};

exports.down = async function (knex) {
    await knex.raw(`
        ALTER TABLE users
        DROP CONSTRAINT IF EXISTS users_email_unique
    `);
};
