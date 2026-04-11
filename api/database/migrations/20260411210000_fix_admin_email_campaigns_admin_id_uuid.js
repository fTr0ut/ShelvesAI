/**
 * Fix admin_email_campaigns.admin_id column type from integer to uuid.
 * The original migration incorrectly used t.integer() — users.id is a UUID PK.
 * The table is new and empty so a drop+add is safe.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('admin_email_campaigns', (t) => {
    t.dropColumn('admin_id');
  }).then(() =>
    knex.schema.alterTable('admin_email_campaigns', (t) => {
      t.uuid('admin_id').nullable();
    })
  );
};

exports.down = function (knex) {
  return knex.schema.alterTable('admin_email_campaigns', (t) => {
    t.dropColumn('admin_id');
  }).then(() =>
    knex.schema.alterTable('admin_email_campaigns', (t) => {
      t.integer('admin_id').nullable();
    })
  );
};
