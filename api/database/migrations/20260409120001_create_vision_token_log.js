/**
 * Creates per-call token usage audit table for vision pipeline jobs.
 * Each Gemini API call within a job gets its own row; aggregate by job_id.
 */
exports.up = async function (knex) {
    await knex.schema.createTable('vision_token_log', (table) => {
        table.increments('id').primary();
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.text('job_id').notNullable();
        table.text('call_label').notNullable();
        table.integer('prompt_tokens').notNullable().defaultTo(0);
        table.integer('candidates_tokens').notNullable().defaultTo(0);
        table.integer('total_tokens').notNullable().defaultTo(0);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX idx_vision_token_log_user_id ON vision_token_log(user_id)');
    await knex.raw('CREATE INDEX idx_vision_token_log_job_id ON vision_token_log(job_id)');
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('vision_token_log');
};
