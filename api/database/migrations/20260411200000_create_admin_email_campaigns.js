/**
 * Create admin_email_campaigns table for tracking sent email campaigns.
 */
exports.up = function (knex) {
  return knex.schema.createTable('admin_email_campaigns', (t) => {
    t.increments('id');
    t.integer('admin_id');                       // nullable — preserved if admin account later deleted
    t.text('subject').notNullable();
    t.text('template_id').notNullable();
    t.text('audience_type').notNullable();       // e.g. 'all', 'premium', 'resend:abc-123'
    t.text('audience_label').nullable();          // human-readable label for display
    t.integer('recipient_count').defaultTo(0);
    t.integer('sent_count').defaultTo(0);
    t.integer('failed_count').defaultTo(0);
    t.text('status').defaultTo('sent');           // 'sent' | 'failed'
    t.timestamp('sent_at', { useTz: true }).defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('admin_email_campaigns');
};
