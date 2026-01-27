/**
 * Add cover media fields to user_manuals table
 * Enables custom cover images for manual collection items
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('user_manuals', (table) => {
    table.text('cover_media_path').nullable();
    table.varchar('cover_content_type', 100).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('user_manuals', (table) => {
    table.dropColumn('cover_media_path');
    table.dropColumn('cover_content_type');
  });
};
