/**
 * Creates password_reset_tokens table for forgot password functionality.
 */

exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE password_reset_tokens (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await knex.raw(`
        CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id)
    `);

    await knex.raw(`
        CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token)
    `);

    await knex.raw(`
        CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at)
    `);
};

exports.down = async function (knex) {
    await knex.raw(`DROP TABLE IF EXISTS password_reset_tokens`);
};
