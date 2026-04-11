exports.up = async function (knex) {
  await knex.schema.createTable('deletion_requests', (table) => {
    table.increments('id').primary();
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.text('reason').nullable();
    table.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected
    table.uuid('reviewed_by').nullable().references('id').inTable('users');
    table.text('reviewer_note').nullable();
    table.timestamp('processed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Prevent duplicate pending requests per user
  await knex.raw(`
    CREATE UNIQUE INDEX deletion_requests_pending_user_idx
    ON deletion_requests (user_id)
    WHERE status = 'pending'
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('deletion_requests');
};
