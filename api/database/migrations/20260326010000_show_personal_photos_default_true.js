exports.up = async function (knex) {
  // Change show_personal_photos default to TRUE and flip all existing users
  const hasUsers = await knex.schema.hasTable('users');
  if (hasUsers) {
    const hasCol = await knex.schema.hasColumn('users', 'show_personal_photos');
    if (hasCol) {
      await knex.schema.alterTable('users', (table) => {
        table.boolean('show_personal_photos').notNullable().defaultTo(true).alter();
      });
      await knex.raw('UPDATE users SET show_personal_photos = TRUE');
    }
  }

  // Change owner_photo_visible default to TRUE
  const hasUC = await knex.schema.hasTable('user_collections');
  if (hasUC) {
    const hasVisCol = await knex.schema.hasColumn('user_collections', 'owner_photo_visible');
    if (hasVisCol) {
      await knex.schema.alterTable('user_collections', (table) => {
        table.boolean('owner_photo_visible').notNullable().defaultTo(true).alter();
      });
    }
  }
};

exports.down = async function (knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (hasUsers) {
    const hasCol = await knex.schema.hasColumn('users', 'show_personal_photos');
    if (hasCol) {
      await knex.schema.alterTable('users', (table) => {
        table.boolean('show_personal_photos').notNullable().defaultTo(false).alter();
      });
    }
  }

  const hasUC = await knex.schema.hasTable('user_collections');
  if (hasUC) {
    const hasVisCol = await knex.schema.hasColumn('user_collections', 'owner_photo_visible');
    if (hasVisCol) {
      await knex.schema.alterTable('user_collections', (table) => {
        table.boolean('owner_photo_visible').notNullable().defaultTo(false).alter();
      });
    }
  }
};
